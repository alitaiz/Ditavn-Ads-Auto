// backend/routes/ai.js
import express from 'express';
import pool from '../db.js';
import { GoogleGenAI, Type } from '@google/genai';
import { agentApp } from '../services/langchain/agent.js';

const router = express.Router();
// This instance is still used for the New Product launch plan feature.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Endpoint to suggest a PPC rule or a launch plan
router.post('/ai/suggest-rule', async (req, res) => {
    const { isNewProduct, productData, ruleType, dateRange } = req.body;

    try {
        if (isNewProduct) {
            // Logic for New Product (uses direct Gemini call, sends single JSON response)
            const result = await getNewProductLaunchPlan(productData);
            res.json(result);
        } else {
            // Logic for Existing Product (uses LangGraph Agent with streaming)
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            await streamExistingProductRule(res, productData, ruleType, dateRange);
        }
    } catch (error) {
        console.error('[AI Suggester] Error:', error);
        // If headers are not sent, send an error response. Otherwise, just end.
        if (!res.headersSent) {
            res.status(500).json({ error: error.message || 'An internal server error occurred.' });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
            res.end();
        }
    }
});

// --- Function for NEW PRODUCT Launch Plan (Unchanged) ---
const getNewProductLaunchPlan = async (productData) => {
    const { description, competitors, usp, goal } = productData;
    
    const prompt = `
        BẠN LÀ MỘT CHUYÊN GIA VỀ AMAZON PPC. Nhiệm vụ của bạn là tạo ra một "Kế hoạch Khởi chạy PPC" (PPC Launch Playbook) chi tiết cho một sản phẩm mới dựa trên thông tin được cung cấp. Cung cấp kết quả dưới dạng JSON hợp lệ và một lời giải thích chiến lược bằng tiếng Việt.

        Thông tin sản phẩm:
        - Mô tả: ${description}
        - Đối thủ cạnh tranh chính: ${competitors}
        - Điểm bán hàng độc nhất (USP): ${usp}
        - Mục tiêu chiến dịch: ${goal}

        Dựa vào thông tin trên, hãy tạo ra:
        1.  **suggestedKeywords**: Một danh sách các từ khóa khởi đầu, được phân loại thành 'core' (chính) và 'long_tail' (đuôi dài).
        2.  **suggestedCampaigns**: Đề xuất cấu trúc chiến dịch, bao gồm ít nhất một chiến dịch Tự động (Auto) và một chiến dịch Thủ công (Manual).
        3.  **suggestedRules**: Đề xuất 2 quy tắc tự động hóa ban đầu.
            - Một quy tắc "phòng thủ" loại 'SEARCH_TERM_AUTOMATION' để phủ định các search term không hiệu quả.
            - Một quy tắc "tấn công" gợi ý logic để "tốt nghiệp" các search term tốt từ chiến dịch Auto sang Manual.
        4.  **reasoning**: Giải thích ngắn gọn về chiến lược đằng sau các đề xuất của bạn bằng tiếng Việt.
    `;

    const schema = {
        type: Type.OBJECT,
        properties: {
            suggestedKeywords: {
                type: Type.OBJECT,
                properties: {
                    core: { type: Type.ARRAY, items: { type: Type.STRING } },
                    long_tail: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
            },
            suggestedCampaigns: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: { name: { type: 'STRING' }, type: { type: 'STRING' }, purpose: { type: 'STRING' } }
                }
            },
            suggestedRules: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: { name: { type: 'STRING' }, logic: { type: 'STRING' }, reasoning: { type: 'STRING' } }
                }
            },
            reasoning: { type: 'STRING' }
        },
        required: ["suggestedKeywords", "suggestedCampaigns", "suggestedRules", "reasoning"]
    };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: schema },
    });

    const result = JSON.parse(response.text);
    return { type: 'playbook', playbook: result };
};

// --- Function for EXISTING PRODUCT Rule Suggestion (Streaming Version) ---
const streamExistingProductRule = async (res, productData, ruleType, dateRange) => {
    const agentInput = {
        userInput: { productData, ruleType, dateRange }
    };

    const stream = await agentApp.stream(agentInput);

    for await (const chunk of stream) {
        if (chunk.gatherData) {
            const { financialMetrics, performanceData, error } = chunk.gatherData;
            if (error) {
                res.write(`data: ${JSON.stringify({ type: 'error', content: error })}\n\n`);
                return;
            }
            const dataSummary = {
                financial: financialMetrics,
                performance: {
                    totalSpend: parseFloat(performanceData.total_spend),
                    totalSales: parseFloat(performanceData.total_sales),
                    overallAcos: parseFloat(performanceData.total_sales) > 0 ? (parseFloat(performanceData.total_spend) / parseFloat(performanceData.total_sales)) * 100 : 0,
                }
            };
            res.write(`data: ${JSON.stringify({ type: 'dataSummary', content: dataSummary })}\n\n`);
        }
        if (chunk.analyzePerformance) {
            const { analysis, error } = chunk.analyzePerformance;
            if (error) {
                res.write(`data: ${JSON.stringify({ type: 'error', content: error })}\n\n`);
                return;
            }
            res.write(`data: ${JSON.stringify({ type: 'analysis', content: analysis })}\n\n`);
        }
        if (chunk.strategize) {
            const { strategy, error } = chunk.strategize;
             if (error) {
                res.write(`data: ${JSON.stringify({ type: 'error', content: error })}\n\n`);
                return;
            }
            res.write(`data: ${JSON.stringify({ type: 'strategy', content: strategy })}\n\n`);
        }
        if (chunk.constructRule) {
            const { finalResult, error } = chunk.constructRule;
            if (error) {
                res.write(`data: ${JSON.stringify({ type: 'error', content: error })}\n\n`);
                return;
            }
            res.write(`data: ${JSON.stringify({ type: 'rule', content: finalResult })}\n\n`);
        }
    }
    res.end();
};


export default router;