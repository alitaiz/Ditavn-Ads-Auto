// backend/routes/ai.js
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';

const router = express.Router();
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const conversations = new Map(); // In-memory store for conversation history

// --- Tool Endpoints (for Frontend to pre-load data) ---

router.post('/ai/tool/search-term', async (req, res) => {
    const { asin, startDate, endDate } = req.body;
    if (!asin || !startDate || !endDate) {
        return res.status(400).json({ error: 'ASIN, startDate, and endDate are required.' });
    }
    try {
        // UPDATED LOGIC: Use the date range provided by the user directly.
        // The data source has a natural 2-day lag, which is explained to the AI
        // in the system instruction. The query will simply return available data
        // within the requested range.
        const reportStartDateStr = startDate;
        const reportEndDateStr = endDate;
        
        console.log(`[AI Tool/SearchTerm] Using user-provided date range directly: ${reportStartDateStr} to ${reportEndDateStr}`);

        const query = `
            WITH combined_reports AS (
                -- Sponsored Products
                SELECT
                    customer_search_term,
                    impressions,
                    clicks,
                    cost,
                    sales_7d as sales,
                    purchases_7d as orders
                FROM sponsored_products_search_term_report
                WHERE asin = $1 AND report_date BETWEEN $2 AND $3
                
                UNION ALL

                -- Sponsored Brands
                SELECT
                    customer_search_term,
                    impressions,
                    clicks,
                    cost,
                    sales,
                    purchases as orders
                FROM sponsored_brands_search_term_report
                WHERE asin = $1 AND report_date BETWEEN $2 AND $3

                UNION ALL

                -- Sponsored Display
                SELECT
                    targeting_text as customer_search_term,
                    impressions,
                    clicks,
                    cost,
                    sales,
                    purchases as orders
                FROM sponsored_display_targeting_report
                WHERE asin = $1 AND report_date BETWEEN $2 AND $3
            )
            SELECT
                customer_search_term,
                SUM(COALESCE(impressions, 0)) as impressions,
                SUM(COALESCE(clicks, 0)) as clicks,
                SUM(COALESCE(cost, 0)) as spend,
                SUM(COALESCE(sales, 0)) as sales,
                SUM(COALESCE(orders, 0)) as orders
            FROM combined_reports
            WHERE customer_search_term IS NOT NULL
            GROUP BY customer_search_term
            ORDER BY SUM(COALESCE(cost, 0)) DESC;
        `;
        const { rows } = await pool.query(query, [asin, reportStartDateStr, reportEndDateStr]);
        res.json({
            data: rows,
            dateRange: {
                startDate: reportStartDateStr,
                endDate: reportEndDateStr,
            }
        });
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
        const lookbackStartDate = new Date(endDate);
        lookbackStartDate.setDate(lookbackStartDate.getDate() - 29); // 30-day lookback
        const lookbackStartDateStr = lookbackStartDate.toISOString().split('T')[0];
        
        const campaignIdQuery = `
            SELECT DISTINCT campaign_id 
            FROM sponsored_products_search_term_report 
            WHERE asin = $1 AND report_date BETWEEN $2 AND $3;
        `;
        const campaignIdResult = await pool.query(campaignIdQuery, [asin, lookbackStartDateStr, endDate]);
        const campaignIds = campaignIdResult.rows.map(r => r.campaign_id);

        if (campaignIds.length === 0) {
            return res.json({ data: [], dateRange: { startDate, endDate } });
        }
        
        const streamQuery = `
            WITH traffic AS (
                SELECT SUM((event_data->>'cost')::numeric) as spend, SUM((event_data->>'clicks')::bigint) as clicks
                FROM raw_stream_events
                WHERE event_type = 'sp-traffic'
                AND (event_data->>'campaign_id')::bigint = ANY($1)
                AND (event_data->>'time_window_start')::timestamptz >= $2::date
                AND (event_data->>'time_window_start')::timestamptz < ($3::date + interval '1 day')
            ),
            conversion AS (
                SELECT SUM((event_data->>'attributed_sales_1d')::numeric) as sales, SUM((event_data->>'attributed_conversions_1d')::bigint) as orders
                FROM raw_stream_events
                WHERE event_type = 'sp-conversion'
                AND (event_data->>'campaign_id')::bigint = ANY($1)
                AND (event_data->>'time_window_start')::timestamptz >= $2::date
                AND (event_data->>'time_window_start')::timestamptz < ($3::date + interval '1 day')
            )
            SELECT * FROM traffic, conversion;
        `;
        const { rows } = await pool.query(streamQuery, [campaignIds, startDate, endDate]);
        res.json({ data: rows, dateRange: { startDate, endDate } });
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
        res.json({ data: rows, dateRange: { startDate, endDate } });
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

        const systemInstruction = context.systemInstruction || 'You are an expert Amazon PPC Analyst.';

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
                systemInstruction: systemInstruction
            }
        });
        
        let currentMessage;
        if (history.length === 0) {
            currentMessage = `
Here is the data context for my question. Please analyze it before answering, paying close attention to the different date ranges for each data source.

**Product Information:**
- ASIN: ${context.productInfo.asin || 'Not provided'}
- Sale Price: $${context.productInfo.salePrice || 'Not provided'}
- Product Cost: $${context.productInfo.cost || 'Not provided'}
- FBA Fee: $${context.productInfo.fbaFee || 'Not provided'}
- Referral Fee: ${context.productInfo.referralFeePercent || '15'}%

**Performance Data:**
- Search Term Data (Date Range: ${context.performanceData.searchTermData.dateRange?.startDate} to ${context.performanceData.searchTermData.dateRange?.endDate}): ${JSON.stringify(context.performanceData.searchTermData.data, null, 2) || 'Not provided'}
- Stream Data (Date Range: ${context.performanceData.streamData.dateRange?.startDate} to ${context.performanceData.streamData.dateRange?.endDate}): ${JSON.stringify(context.performanceData.streamData.data, null, 2) || 'Not provided'}
- Sales & Traffic Data (Date Range: ${context.performanceData.salesTrafficData.dateRange?.startDate} to ${context.performanceData.salesTrafficData.dateRange?.endDate}): ${JSON.stringify(context.performanceData.salesTrafficData.data, null, 2) || 'Not provided'}

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
                    res.write(JSON.stringify({ conversationId, content: chunkText }) + '\n');
                    firstChunk = false;
                } else {
                    res.write(JSON.stringify({ content: chunkText }) + '\n');
                }
            }
        }
        
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