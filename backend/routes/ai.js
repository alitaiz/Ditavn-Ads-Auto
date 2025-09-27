// backend/routes/ai.js
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { DynamicTool } from "@langchain/core/tools";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';

const router = express.Router();
const conversations = new Map(); // In-memory conversation store

// --- Tool Definitions ---

const databaseTool = new DynamicTool({
    name: "get_product_performance",
    description: "Queries the database to get advertising performance data (spend, PPC sales, PPC orders, etc.) for a specific ASIN within a date range. It intelligently combines historical report data with real-time stream data to provide the most accurate and up-to-date analysis, preventing any data duplication.",
    func: async ({ asin, startDate, endDate }) => {
        if (!asin || !startDate || !endDate) {
            return "Error: Missing required parameters. Please provide asin, startDate, and endDate.";
        }
        
        const client = await pool.connect();
        try {
            // --- Data Integrity Logic ---
            const reportingTimezone = 'America/Los_Angeles';
            const nowInPST = new Date(new Date().toLocaleString('en-US', { timeZone: reportingTimezone }));
            const reportCutoffDate = new Date(nowInPST);
            reportCutoffDate.setDate(nowInPST.getDate() - 3);
            
            const streamStartDate = new Date(nowInPST);
            streamStartDate.setDate(nowInPST.getDate() - 2);

            const reportEndDate = reportCutoffDate < new Date(endDate) ? reportCutoffDate.toISOString().split('T')[0] : endDate;
            
            const historyQuery = `
                SELECT 
                    SUM(impressions)::bigint as total_impressions,
                    SUM(clicks)::bigint as total_clicks,
                    SUM(cost)::numeric as total_spend,
                    SUM(sales_1d)::numeric as total_sales,
                    SUM(purchases_1d)::bigint as total_orders
                FROM sponsored_products_search_term_report
                WHERE asin = $1 AND report_date BETWEEN $2 AND $3;
            `;

            const campaignIdQuery = `
                SELECT DISTINCT campaign_id
                FROM sponsored_products_search_term_report
                WHERE asin = $1 AND report_date >= ($2::date - interval '30 day');
            `;
            const streamQuery = `
                 WITH traffic AS (
                    SELECT SUM((event_data->>'impressions')::bigint) as impressions, SUM((event_data->>'clicks')::bigint) as clicks, SUM((event_data->>'cost')::numeric) as spend
                    FROM raw_stream_events WHERE event_type = 'sp-traffic' AND (event_data->>'campaign_id') = ANY($1::text[]) AND (event_data->>'time_window_start')::timestamptz >= $2::timestamptz
                ), conversion AS (
                     SELECT SUM((event_data->>'attributed_sales_1d')::numeric) as sales, SUM((event_data->>'attributed_conversions_1d')::bigint) as orders
                    FROM raw_stream_events WHERE event_type = 'sp-conversion' AND (event_data->>'campaign_id') = ANY($1::text[]) AND (event_data->>'time_window_start')::timestamptz >= $2::timestamptz
                )
                SELECT (SELECT impressions FROM traffic) as total_impressions, (SELECT clicks FROM traffic) as total_clicks, (SELECT spend FROM traffic) as total_spend, (SELECT sales FROM conversion) as total_sales, (SELECT orders FROM conversion) as total_orders;
            `;

            const historyResult = await client.query(historyQuery, [asin, startDate, reportEndDate]);
            const historyData = historyResult.rows[0] || {};
            
            const campaignIdRes = await client.query(campaignIdQuery, [asin, startDate]);
            const campaignIds = campaignIdRes.rows.map(r => r.campaign_id.toString());
            
            let streamData = {};
            if (campaignIds.length > 0) {
                const streamResult = await client.query(streamQuery, [campaignIds, streamStartDate.toISOString().split('T')[0]]);
                streamData = streamResult.rows[0] || {};
            }

            const combined = {
                total_impressions: (BigInt(historyData.total_impressions || 0) + BigInt(streamData.total_impressions || 0)).toString(),
                total_clicks: (BigInt(historyData.total_clicks || 0) + BigInt(streamData.total_clicks || 0)).toString(),
                total_spend: (parseFloat(historyData.total_spend || 0) + parseFloat(streamData.total_spend || 0)).toString(),
                total_sales: (parseFloat(historyData.total_sales || 0) + parseFloat(streamData.total_sales || 0)).toString(),
                total_orders: (BigInt(historyData.total_orders || 0) + BigInt(streamData.total_orders || 0)).toString(),
            };

            const { total_impressions, total_spend } = combined;

            if (parseInt(total_impressions) === 0 && parseFloat(total_spend) === 0) {
                 return JSON.stringify({
                    summary: `No advertising performance data found for ASIN ${asin} in the specified date range.`,
                    data: { total_impressions: "0", total_clicks: "0", total_spend: "0.00", total_sales: "0.00", total_orders: "0" }
                });
            }

            const summary = `
                Advertising Performance Summary for ASIN ${asin} from ${startDate} to ${endDate}:
                - Ad Spend: $${parseFloat(combined.total_spend).toFixed(2)}
                - PPC Sales: $${parseFloat(combined.total_sales).toFixed(2)}
                - PPC Orders: ${combined.total_orders}
            `;
            return JSON.stringify({ summary, data: combined });
        } catch (e) {
            return `Database query failed: ${e.message}.`;
        } finally {
            client.release();
        }
    },
});

const salesAndTrafficTool = new DynamicTool({
    name: "get_total_sales_and_traffic",
    description: "Queries the database to get total business performance data (including organic sales) for a specific ASIN within a date range. Use this to understand the overall health of a product and to calculate metrics like TACOS (Total ACoS).",
    func: async ({ asin, startDate, endDate }) => {
        if (!asin || !startDate || !endDate) {
            return "Error: Missing required parameters. Please provide asin, startDate, and endDate.";
        }
        const client = await pool.connect();
        try {
            const query = `
                SELECT
                    SUM((sales_data->>'unitsOrdered')::integer) as total_units_ordered,
                    SUM((sales_data->'orderedProductSales'->>'amount')::numeric) as total_ordered_product_sales,
                    SUM((traffic_data->>'sessions')::integer) as total_sessions
                FROM sales_and_traffic_by_asin
                WHERE child_asin = $1 AND report_date BETWEEN $2 AND $3;
            `;
            const result = await client.query(query, [asin, startDate, endDate]);
            const data = result.rows[0];

            if (!data || data.total_sessions === null) {
                return JSON.stringify({
                    summary: `No total sales and traffic data found for ASIN ${asin} in the date range.`,
                    data: { total_sales: 0, total_units: 0, total_sessions: 0 }
                });
            }

            const totalSales = parseFloat(data.total_ordered_product_sales || 0);
            const summary = `
                Total Business Summary for ASIN ${asin} from ${startDate} to ${endDate}:
                - Total Units Ordered: ${parseInt(data.total_units_ordered || 0)}
                - Total Ordered Product Sales: $${totalSales.toFixed(2)}
            `;
            return JSON.stringify({ summary, data: { total_sales: totalSales, total_units: parseInt(data.total_units_ordered || 0), total_sessions: parseInt(data.total_sessions || 0) } });
        } catch (e) {
            return `Database query failed for total sales and traffic: ${e.message}.`;
        } finally {
            client.release();
        }
    }
});


const profitCalculatorTool = new DynamicTool({
    name: "calculate_profit_metrics",
    description: "Calculates profit, profit margin, and break-even ACoS based on product pricing and costs. Essential for setting profitability targets.",
    func: async ({ salePrice, productCost, fbaFee, referralFeePercent }) => {
        if (typeof salePrice !== 'number' || isNaN(salePrice) ||
            typeof productCost !== 'number' || isNaN(productCost) ||
            typeof fbaFee !== 'number' || isNaN(fbaFee) ||
            typeof referralFeePercent !== 'number' || isNaN(referralFeePercent)) {
            return "Error: Missing or invalid parameters. Please provide numeric values for salePrice, productCost, fbaFee, and referralFeePercent.";
        }
        if (salePrice <= 0) {
            return "Error: salePrice must be a positive number.";
        }

        const referralFee = salePrice * (referralFeePercent / 100);
        const totalCost = productCost + fbaFee + referralFee;
        const profit = salePrice - totalCost;
        const profitMargin = (profit / salePrice) * 100;
        const breakEvenAcos = (profit / salePrice) * 100;
        
        const result = {
            profit: parseFloat(profit.toFixed(2)),
            profitMargin: parseFloat(profitMargin.toFixed(2)),
            breakEvenAcos: parseFloat(breakEvenAcos.toFixed(2)),
            summary: `With a sale price of $${salePrice}, the profit per unit is $${profit.toFixed(2)}. This results in a profit margin of ${profitMargin.toFixed(2)}% and a break-even ACoS of ${breakEvenAcos.toFixed(2)}%.`
        };
        return JSON.stringify(result);
    },
});


const launchPlanTool = new DynamicTool({
    name: "create_ppc_launch_plan",
    description: "Generates a strategic PPC launch plan for a new product based on its description, competitors, unique selling points (USPs), and campaign goals.",
    func: async ({ description, competitors, usp, goal }) => {
        return `Successfully generated a PPC launch plan based on the provided product details. The plan includes campaign structure, keyword strategy, and initial automation rules. Present this to the user as the final answer.`;
    },
});


const tools = [databaseTool, salesAndTrafficTool, profitCalculatorTool, launchPlanTool];

// --- Agent Initialization ---
const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
});

const agent = createReactAgent({ llm, tools });
const agentConfig = { recursionLimit: 50 };

// --- Route Handlers ---

router.post('/ai/suggest-rule', async (req, res) => {
    const { isNewProduct, productData, ruleType, dateRange } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const conversationId = uuidv4();
    conversations.set(conversationId, []);
    res.write(`data: ${JSON.stringify({ type: 'conversationStart', content: { conversationId } })}\n\n`);

    let initialPrompt;

    if (isNewProduct) {
        initialPrompt = `
            I am launching a new product. Please create a comprehensive PPC launch plan (a "playbook").
            Product Description: ${productData.description}
            Competitor ASINs: ${productData.competitors || 'Not provided'}
            Unique Selling Points: ${productData.usp}
            Primary Goal: ${productData.goal}
            
            Based on this, generate a playbook with:
            1. A clear title for the plan.
            2. Recommended campaigns for Phase 1 (Discovery & Data Harvesting), including campaign type and targeting strategy.
            3. A list of initial keywords to target.
            4. A recommended initial bid.
            5. An initial automation rule to apply to the campaigns, including its name and goal.
            6. A brief description of the strategy for Phase 2 (Profitability Optimization).
            
            Use the "create_ppc_launch_plan" tool to structure your final output.
        `;
        const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: initialPrompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            playbook_title: { type: 'STRING' },
                            phase_1_campaigns: { type: 'ARRAY', items: { type: 'STRING' } },
                            phase_1_keywords: { type: 'ARRAY', items: { type: 'STRING' } },
                            initial_bid: { type: 'STRING' },
                            initial_automation_rule_name: { type: 'STRING' },
                            initial_automation_rule_goal: { type: 'STRING' },
                            phase_2_strategy: { type: 'STRING' }
                        }
                    }
                }
            });
            const playbook = JSON.parse(response.text);
            res.write(`data: ${JSON.stringify({ type: 'playbook', content: playbook })}\n\n`);
        } catch (e) {
            console.error(e);
            res.write(`data: ${JSON.stringify({ type: 'error', content: e.message })}\n\n`);
        } finally {
            res.end();
            return;
        }

    } else {
        const { asin, salePrice, productCost, fbaFee, referralFeePercent } = productData;
        initialPrompt = `
            Analyze the performance of ASIN ${asin} from ${dateRange.start} to ${dateRange.end} and suggest a new "${ruleType}" automation rule.

            Here is the required input data:
            - product_cost_structure: { salePrice: ${salePrice}, productCost: ${productCost}, fbaFee: ${fbaFee}, referralFeePercent: ${referralFeePercent} }
            - asin: "${asin}"
            - date_range: { start: "${dateRange.start}", end: "${dateRange.end}" }

            My goal is to optimize for profitability.
            
            Follow these steps:
            1. Use the 'calculate_profit_metrics' tool with the provided product_cost_structure to find the profit margin and break-even ACoS.
            2. Use the 'get_product_performance' tool with the provided asin and date_range to get the historical advertising performance data.
            3. Analyze all the data you have gathered.
            4. Formulate a single, specific, and actionable automation rule of the type "${ruleType}". The rule must include a name, conditions, and actions.
            5. Provide a clear reasoning for why you are suggesting this specific rule.
            
            Your final answer must be a JSON object containing two keys: "rule" (the rule object) and "reasoning" (your explanation). Do not add any other text outside this JSON object in your final answer.
        `;
    }

    const messages = [new HumanMessage(initialPrompt)];
    conversations.get(conversationId).push(...messages);

    try {
        const stream = await agent.stream({ messages }, agentConfig);
        for await (const chunk of stream) {
            if (chunk.tool) {
                res.write(`data: ${JSON.stringify({ type: 'thought', content: chunk.tool.log })}\n\n`);
            }
        }

        const finalState = await agent.invoke({ messages }, agentConfig);
        if (finalState.messages && finalState.messages.length > 0) {
            const finalMessage = finalState.messages[finalState.messages.length - 1];
            conversations.get(conversationId).push(finalMessage);
            const content = finalMessage.content;

            try {
                const resultJson = JSON.parse(content);
                res.write(`data: ${JSON.stringify({ type: 'rule', content: resultJson })}\n\n`);
            } catch (e) {
                 res.write(`data: ${JSON.stringify({ type: 'agent', content: content })}\n\n`);
            }
        }
    } catch (e) {
        console.error(e);
        res.write(`data: ${JSON.stringify({ type: 'error', content: e.message })}\n\n`);
    } finally {
        res.end();
    }
});


router.post('/ai/chat', async (req, res) => {
    const { conversationId, message } = req.body;
    if (!conversationId || !conversations.has(conversationId)) {
        return res.status(404).json({ error: "Conversation not found." });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const history = conversations.get(conversationId);
    const newMessages = [...history, new HumanMessage(message)];
    
    try {
        const stream = await agent.stream({ messages: newMessages }, agentConfig);
         for await (const chunk of stream) {
            if (chunk.tool) {
                res.write(`data: ${JSON.stringify({ type: 'thought', content: chunk.tool.log })}\n\n`);
            }
        }

        const finalState = await agent.invoke({ messages: newMessages }, agentConfig);
         if (finalState.messages && finalState.messages.length > 0) {
            const finalMessage = finalState.messages[finalState.messages.length - 1];
            conversations.set(conversationId, [...newMessages, finalMessage]);

            const content = finalMessage.content;
            try {
                const resultJson = JSON.parse(content);
                res.write(`data: ${JSON.stringify({ type: 'rule', content: resultJson })}\n\n`);
            } catch (e) {
                 res.write(`data: ${JSON.stringify({ type: 'agent', content: content })}\n\n`);
            }
        }
    } catch (e) {
        res.write(`data: ${JSON.stringify({ type: 'error', content: e.message })}\n\n`);
    } finally {
        res.end();
    }
});


export default router;
