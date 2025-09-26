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
            // --- Logic for New Product (uses direct Gemini call) ---
            const result = await getNewProductLaunchPlan(productData);
            res.json(result);
        } else {
            // --- Logic for Existing Product (uses new LangGraph Agent) ---
            const result = await getExistingProductRule(productData, ruleType, dateRange);
            res.json(result);
        }
    } catch (error) {
        console.error('[AI Suggester] Error:', error);
        res.status(500).json({ error: error.message || 'An internal server error occurred.' });
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
                    properties: { name: { type: Type.STRING }, type: { type: Type.STRING }, purpose: { type: Type.STRING } }
                }
            },
            suggestedRules: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: { name: { type: Type.STRING }, logic: { type: Type.STRING }, reasoning: { type: Type.STRING } }
                }
            },
            reasoning: { type: Type.STRING }
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

// --- Function for EXISTING PRODUCT Rule Suggestion (Upgraded to use LangGraph Agent) ---
const getExistingProductRule = async (productData, ruleType, dateRange) => {
    // 1. Prepare the initial input for the agent.
    const agentInput = {
        userInput: {
            productData,
            ruleType,
            dateRange
        }
    };

    // 2. Stream the agent's execution to get the final state.
    let finalState;
    // The `stream` method returns events as the agent runs. We wait for the final `end` event.
    for await (const event of await agentApp.stream(agentInput)) {
        if (event.end) {
            finalState = event.end;
        }
    }

    // 3. Handle potential errors from the agent.
    if (finalState.error) {
        return {
            type: 'rule',
            rule: null,
            reasoning: finalState.error, // Pass the agent's error message to the frontend.
            dataSummary: null
        };
    }

    // 4. Construct the response for the frontend from the agent's final state.
    const { financialMetrics, performanceData } = finalState;
    const { profitPerUnit, breakEvenAcos } = financialMetrics;
    const { total_spend, total_sales } = performanceData;

    const dataSummary = {
        financial: {
            profitPerUnit,
            breakEvenAcos,
            targetAcos: breakEvenAcos * 0.8
        },
        performance: {
            totalSpend: parseFloat(total_spend),
            totalSales: parseFloat(total_sales),
            overallAcos: total_sales > 0 ? (total_spend / total_sales) * 100 : 0,
        }
    };
    
    const { rule, reasoning } = finalState.finalResult;

    return { type: 'rule', rule, reasoning, dataSummary };
};


export default router;