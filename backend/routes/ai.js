// backend/routes/ai.js
import express from 'express';
import pool from '../db.js';
import { GoogleGenAI } from '@google/genai';
import { agentApp } from '../services/langchain/agent.js';
import { HumanMessage } from "@langchain/core/messages";
import crypto from 'crypto';

const router = express.Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// In-memory store for conversation states.
// In a production environment, this should be replaced with a persistent store like Redis or a database.
const conversations = new Map();

// Endpoint to suggest a PPC rule or a launch plan
router.post('/ai/suggest-rule', async (req, res) => {
    const { isNewProduct, productData, ruleType, dateRange } = req.body;

    try {
        if (isNewProduct) {
            const result = await getNewProductLaunchPlan(productData);
            res.json({ type: 'playbook', content: result });
        } else {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            const conversationId = crypto.randomUUID();
            const agentInput = { userInput: { productData, ruleType, dateRange } };
            const initialMessage = new HumanMessage(JSON.stringify(agentInput));

            await streamAndRecordConversation(res, conversationId, [initialMessage]);
        }
    } catch (error) {
        handleStreamError(res, error, '[AI Suggester] Initial Request Error:');
    }
});

// NEW Endpoint for follow-up chat messages
router.post('/ai/chat', async (req, res) => {
    const { conversationId, message } = req.body;
    if (!conversationId || !message) {
        return res.status(400).json({ error: 'conversationId and message are required.' });
    }

    const previousMessages = conversations.get(conversationId);
    if (!previousMessages) {
        return res.status(404).json({ error: 'Conversation not found or has expired.' });
    }
    
    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const currentMessages = [...previousMessages, new HumanMessage(message)];
        
        // We don't need to send the conversation ID back on follow-ups
        await streamAndRecordConversation(res, conversationId, currentMessages, false);

    } catch (error) {
        handleStreamError(res, error, `[AI Chat] Conversation ${conversationId} Error:`);
    }
});


const tryParseJson = (value) => {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const jsonRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
    const match = trimmed.match(jsonRegex);
    const candidate = match && match[1] ? match[1] : trimmed;
    try {
        return JSON.parse(candidate);
    } catch (e) {
        return null;
    }
};

const extractTextFromContent = (content) => {
    if (!content) return '';
    if (typeof content === 'string') return content;



    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (!part) return '';
                if (typeof part === 'string') return part;
                if (typeof part.text === 'string') return part.text;

                return '';
            })
            .filter(Boolean)
            .join('\n');
    }


    if (typeof content === 'object') {
        if (typeof content.text === 'string') return content.text;
        if (typeof content.response === 'string') return content.response;
        if (typeof content.output_text === 'string') return content.output_text;
        if (typeof content.content === 'string') return content.content;
    }

    return '';
};

const toNumber = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const formatMetric = (value, options = {}) => {
    const numberValue = toNumber(value);
    if (numberValue === null) return null;

    const { style = 'decimal', unit = '' } = options;
    if (style === 'percent') {
        return `${numberValue.toFixed(2)}%`;
    }

    let formatted;
    try {
        formatted = numberValue.toLocaleString('vi-VN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    } catch (_) {
        formatted = numberValue.toFixed(2);
    }

    if (style === 'currency') {
        return `${formatted} ${unit || 'USD'}`;
    }

    return formatted;
};

const describeStructuredObservation = (toolName, parsed) => {
    if (!parsed || typeof parsed !== 'object') return null;

    if (toolName === 'ProductFinancialsCalculator') {
        const profit = formatMetric(parsed.profitPerUnit, { style: 'currency' });
        const breakEvenAcos = formatMetric(parsed.breakEvenAcos, { style: 'percent' });
        if (profit || breakEvenAcos) {
            return [
                'Tool ProductFinancialsCalculator trả về các chỉ số tài chính:',
                profit ? `• Lợi nhuận mỗi đơn vị ước tính: ${profit}` : null,
                breakEvenAcos ? `• ACOS hòa vốn: ${breakEvenAcos}` : null,
            ].filter(Boolean).join('\n');
        }
    }

    if (toolName === 'Get_PPC_Performance_Summary') {
        const spendNumber = toNumber(parsed.total_spend);
        const salesNumber = toNumber(parsed.total_sales);
        const spend = formatMetric(spendNumber, { style: 'currency' });
        const sales = formatMetric(salesNumber, { style: 'currency' });
        const clicks = formatMetric(parsed.total_clicks);
        const orders = formatMetric(parsed.total_orders);
        const acos = spendNumber !== null && salesNumber !== null && salesNumber > 0
            ? formatMetric((spendNumber / salesNumber) * 100, { style: 'percent' })
            : null;

        const lines = [
            'Tool Get_PPC_Performance_Summary tổng hợp dữ liệu hiệu suất:',
            spend ? `• Tổng chi tiêu: ${spend}` : null,
            sales ? `• Tổng doanh thu: ${sales}` : null,
            clicks ? `• Tổng số lượt click: ${clicks}` : null,
            orders ? `• Tổng số đơn hàng: ${orders}` : null,
            acos ? `• ACoS thực tế: ${acos}` : null,
        ].filter(Boolean);

        if (lines.length) {
            return lines.join('\n');
        }
    }

    return null;
};

const formatToolObservation = (toolName, content) => {
    const text = extractTextFromContent(content) || (typeof content === 'string' ? content : '');
    const parsed = tryParseJson(text);

    const structuredDescription = describeStructuredObservation(toolName, parsed);
    if (structuredDescription) {
        return structuredDescription;
    }

    if (parsed && typeof parsed === 'object') {
        const pretty = JSON.stringify(parsed, null, 2);
        return `Tool ${toolName} trả về dữ liệu:\n${pretty}`;
    }

    const cleaned = text || (typeof content === 'object' ? JSON.stringify(content) : '');
    if (!cleaned) return '';
    return `Tool ${toolName} phản hồi: ${cleaned}`;
};

const formatToolCall = (toolCall) => {
    const args = toolCall?.args ?? {};
    let formattedArgs = '';
    try {
        formattedArgs = JSON.stringify(args, null, 2);
    } catch (_) {
        formattedArgs = JSON.stringify(args);
    }

    if (!formattedArgs || formattedArgs === '{}') {
        return `Đang gọi tool ${toolCall.name} để thu thập dữ liệu cần thiết.`;
    }

    return `Đang gọi tool ${toolCall.name} với tham số:\n${formattedArgs}`;

};

const sendSse = (res, payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (typeof res.flush === 'function') {
        try { res.flush(); } catch (_) { /* ignore */ }
    }
};

const streamAndRecordConversation = async (res, conversationId, messages, isNewConversation = true) => {
    let finalMessages = [...messages];

    if (isNewConversation) {
        sendSse(res, { type: 'conversationStart', content: { conversationId } });
    }

    const stream = await agentApp.stream({ messages });

    for await (const chunk of stream) {
        if (chunk.agent) {
            (chunk.agent.messages || []).forEach(msg => {
                finalMessages.push(msg);


                const messageText = (extractTextFromContent(msg.content) || '').trim();

                if (msg.tool_calls?.length) {
                    const toolNames = msg.tool_calls
                        .map(toolCall => toolCall?.name)
                        .filter(Boolean);
                    const defaultThought = toolNames.length
                        ? `Cần sử dụng ${toolNames.join(' và ')} để thu thập dữ liệu trước khi phân tích.`
                        : 'Đang quyết định gọi các tool cần thiết để có đủ dữ liệu.';

                    sendSse(res, { type: 'thought', content: messageText || defaultThought });

                    msg.tool_calls.forEach(toolCall => {
                        sendSse(res, { type: 'action', content: formatToolCall(toolCall) });

                    });
                } else {
                    const maybeJson = tryParseJson(messageText);

                    if (maybeJson && typeof maybeJson === 'object' && (maybeJson.rule || maybeJson.reasoning)) {

                        const reasoning = typeof maybeJson.reasoning === 'string'
                            ? maybeJson.reasoning.trim()
                            : '';
                        if (reasoning) {
                            sendSse(res, { type: 'agent', content: reasoning });
                        }
                        sendSse(res, { type: 'result', content: maybeJson });
                    } else {
                        const fallback = messageText || 'Đã hoàn tất suy luận và chuẩn bị trả lời.';
                        sendSse(res, { type: 'agent', content: fallback });

                    }
                }
            });
        }
        if (chunk.tools) {
            const toolMessages = chunk.tools.messages;
            const messagesArray = Array.isArray(toolMessages) ? toolMessages : [toolMessages].filter(Boolean);

            messagesArray.forEach(msg => {
                finalMessages.push(msg);

                const toolName = msg?.name || msg?.tool_call_id || 'không rõ';
                const formatted = formatToolObservation(toolName, msg.content);

                if (formatted) {
                    sendSse(res, { type: 'observation', content: formatted });
                }
            });
        }
    }

    conversations.set(conversationId, finalMessages);
    res.end();
};

const handleStreamError = (res, error, logPrefix) => {
    console.error(logPrefix, error);
    const errorMessage = error.message || 'An internal server error occurred.';
    if (!res.headersSent) {
        res.status(500).json({ error: errorMessage });
    } else {
        res.write(`data: ${JSON.stringify({ type: 'error', content: errorMessage })}\n\n`);
        res.end();
    }
};


const getNewProductLaunchPlan = async (productData) => {
    const { description, competitors, usp, goal } = productData;
    const prompt = `BẠN LÀ MỘT CHUYÊN GIA VỀ AMAZON PPC... (prompt unchanged)`;
    const schema = { /* ... schema unchanged ... */ };
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema: schema }});
    return JSON.parse(response.text);
};

export default router;