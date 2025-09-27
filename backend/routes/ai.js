// backend/routes/ai.js
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';

const router = express.Router();
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const conversations = new Map(); // In-memory store for conversation history

const getSystemInstruction = () => `You are an expert Amazon PPC Analyst named "Co-Pilot". Your goal is to help users analyze performance data and provide strategic advice.

User will provide you with several pieces of data:
1.  **Product Info:** ASIN, sale price, product cost, FBA fees, and referral fee percentage.
2.  **Performance Data:** This is a JSON object containing up to three data sets:
    *   \`searchTermData\`: Aggregated data from the Sponsored Products Search Term Report.
    *   \`streamData\`: Aggregated real-time data from the Amazon Marketing Stream.
    *   \`salesTrafficData\`: Data from the Sales & Traffic report, which includes organic metrics.

Your Task:
1.  **Always start by acknowledging the data provided.** If some data is missing (e.g., no stream data), mention it.
2.  Answer the user's initial question based on the provided data.
3.  Present your analysis clearly, using formatting like lists and bold text.
4.  If you suggest creating an automation rule, provide the JSON for it in a markdown code block.
5.  Be ready to answer follow-up questions, remembering the context of the data you were initially given.`;

// --- Tool Endpoints (for Frontend to pre-load data) ---

router.post('/ai/tool/search-term', async (req, res) => {
    const { asin, startDate, endDate } = req.body;
    if (!asin || !startDate || !endDate) {
        return res.status(400).json({ error: 'ASIN, startDate, and endDate are required.' });
    }
    try {
        const query = `
            SELECT 
                customer_search_term,
                SUM(impressions) as impressions,
                SUM(clicks) as clicks,
                SUM(cost) as spend,
                SUM(sales_7d) as sales,
                SUM(purchases_7d) as orders
            FROM sponsored_products_search_term_report
            WHERE asin = $1 AND report_date BETWEEN $2 AND $3
            GROUP BY customer_search_term
            ORDER BY SUM(cost) DESC;
        `;
        const { rows } = await pool.query(query, [asin, startDate, endDate]);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/ai/tool/stream', async (req, res) => {
    const { asin, startDate, endDate } = req.body;
    if (!asin || !startDate || !endDate) {
        return res.status(400).json({ error: 'ASIN, startDate, and endDate are required.' });
    }
    try {
        // Step 1: Infer Campaign IDs from ASIN in the search term report
        const campaignIdQuery = `
            SELECT DISTINCT campaign_id 
            FROM sponsored_products_search_term_report 
            WHERE asin = $1 AND report_date BETWEEN $2 AND $3;
        `;
        const campaignIdResult = await pool.query(campaignIdQuery, [asin, startDate, endDate]);
        const campaignIds = campaignIdResult.rows.map(r => r.campaign_id);

        if (campaignIds.length === 0) {
            return res.json([]);
        }
        
        // Step 2: Fetch and aggregate stream data for those campaign IDs
        const streamQuery = `
            WITH traffic AS (
                SELECT SUM((event_data->>'cost')::numeric) as spend, SUM((event_data->>'clicks')::bigint) as clicks
                FROM raw_stream_events
                WHERE event_type = 'sp-traffic'
                AND (event_data->>'campaign_id')::bigint = ANY($1)
                AND (event_data->>'time_window_start')::timestamptz BETWEEN $2 AND $3
            ),
            conversion AS (
                SELECT SUM((event_data->>'attributed_sales_1d')::numeric) as sales, SUM((event_data->>'attributed_conversions_1d')::bigint) as orders
                FROM raw_stream_events
                WHERE event_type = 'sp-conversion'
                AND (event_data->>'campaign_id')::bigint = ANY($1)
                AND (event_data->>'time_window_start')::timestamptz BETWEEN $2 AND $3
            )
            SELECT * FROM traffic, conversion;
        `;
        const { rows } = await pool.query(streamQuery, [campaignIds, startDate, endDate]);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/ai/tool/sales-traffic', async (req, res) => {
    const { asin, startDate, endDate } = req.body;
    if (!asin || !startDate || !endDate) {
        return res.status(400).json({ error: 'ASIN, startDate, and endDate are required.' });
    }
    try {
        const query = `
            SELECT 
                SUM((traffic_data->>'sessions')::int) as total_sessions,
                SUM((sales_data->>'unitsOrdered')::int) as total_units_ordered
            FROM sales_and_traffic_by_asin
            WHERE child_asin = $1 AND report_date BETWEEN $2 AND $3;
        `;
        const { rows } = await pool.query(query, [asin, startDate, endDate]);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Main Chat Endpoint ---

router.post('/ai/chat', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        let { question, conversationId, context } = req.body;
        
        if (!question) {
            throw new Error('Question is required.');
        }

        let history = [];
        if (conversationId && conversations.has(conversationId)) {
            history = conversations.get(conversationId);
        } else {
            conversationId = uuidv4();
        }
        
        const chat = ai.chats.create({
            model: 'gemini-2.5-flash',
            history: history,
            config: {
                systemInstruction: getSystemInstruction()
            }
        });
        
        let currentMessage;
        // If it's the start of a new conversation, build the detailed context prompt.
        // Otherwise, just use the user's follow-up question.
        if (history.length === 0) {
            currentMessage = `
Here is the data context for my question. Please analyze it before answering.

**Product Information:**
- ASIN: ${context.productInfo.asin || 'Not provided'}
- Sale Price: $${context.productInfo.salePrice || 'Not provided'}
- Product Cost: $${context.productInfo.cost || 'Not provided'}
- FBA Fee: $${context.productInfo.fbaFee || 'Not provided'}
- Referral Fee: ${context.productInfo.referralFeePercent || '15'}%

**Performance Data:**
- Search Term Data: ${JSON.stringify(context.performanceData.searchTermData, null, 2) || 'Not provided'}
- Stream Data: ${JSON.stringify(context.performanceData.streamData, null, 2) || 'Not provided'}
- Sales & Traffic Data: ${JSON.stringify(context.performanceData.salesTrafficData, null, 2) || 'Not provided'}

**My Initial Question:**
${question}
`;
        } else {
            currentMessage = question;
        }

        const resultStream = await chat.sendMessageStream({ message: currentMessage });

        let fullResponseText = '';
        let firstChunk = true;
        for await (const chunk of resultStream) {
            const chunkText = chunk.text;
            if (chunkText) {
                fullResponseText += chunkText;
                if (firstChunk) {
                    // Send conversationId with the first chunk
                    res.write(JSON.stringify({ conversationId, content: chunkText }) + '\n');
                    firstChunk = false;
                } else {
                    res.write(JSON.stringify({ content: chunkText }) + '\n');
                }
            }
        }
        
        // Update history after the full response is generated
        const newHistory = [
            ...history,
            { role: 'user', parts: [{ text: currentMessage }] },
            { role: 'model', parts: [{ text: fullResponseText }] }
        ];
        conversations.set(conversationId, newHistory);
        
        res.end();

    } catch (error) {
        console.error("AI chat error:", error);
        res.status(500).end(JSON.stringify({ error: error.message }));
    }
});

export default router;