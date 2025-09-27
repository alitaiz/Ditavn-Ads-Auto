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
    if (typeof content === 'object' && typeof content.text === 'string') {
        return content.text;
    }
    return '';
};

const formatToolObservation = (content) => {
    const text = extractTextFromContent(content) || (typeof content === 'string' ? content : '');
    const parsed = tryParseJson(text);
    if (parsed && typeof parsed === 'object') {
        return JSON.stringify(parsed, null, 2);
    }
    return text || (typeof content === 'object' ? JSON.stringify(content) : '');
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

                const messageText = extractTextFromContent(msg.content).trim();

                if (msg.tool_calls?.length) {
                    if (messageText) {
                        sendSse(res, { type: 'thought', content: messageText });
                    }

                    msg.tool_calls.forEach(toolCall => {
                        let argsString;
                        try {
                            argsString = JSON.stringify(toolCall.args, null, 2);
                        } catch (e) {
                            argsString = JSON.stringify(toolCall.args);
                        }
                        sendSse(res, { type: 'action', content: `${toolCall.name}${argsString || ''}` });
                    });
                } else {
                    const maybeJson = tryParseJson(messageText);

                    if (maybeJson && typeof maybeJson === 'object' && (maybeJson.rule || maybeJson.reasoning)) {
                        if (typeof maybeJson.reasoning === 'string' && maybeJson.reasoning.trim()) {
                            sendSse(res, { type: 'agent', content: maybeJson.reasoning.trim() });
                        }
                        sendSse(res, { type: 'result', content: maybeJson });
                    } else if (messageText) {
                        sendSse(res, { type: 'agent', content: messageText });
                    }
                }
            });
        }
        if (chunk.tools) {
            const toolMessages = chunk.tools.messages;
            const messagesArray = Array.isArray(toolMessages) ? toolMessages : [toolMessages].filter(Boolean);

            messagesArray.forEach(msg => {
                finalMessages.push(msg);
                const formatted = formatToolObservation(msg.content);
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