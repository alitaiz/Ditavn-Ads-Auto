// backend/routes/ai.js
import express from 'express';
import pool from '../db.js';
import { GoogleGenAI, Type } from '@google/genai';
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


const streamAndRecordConversation = async (res, conversationId, messages, isNewConversation = true) => {
    let finalMessages = [...messages];
    
    if (isNewConversation) {
        res.write(`data: ${JSON.stringify({ type: 'conversationStart', content: { conversationId } })}\n\n`);
    }

    const stream = await agentApp.stream({ messages });

    for await (const chunk of stream) {
        if (chunk.agent) {
            (chunk.agent.messages || []).forEach(msg => {
                finalMessages.push(msg); // Add agent's own messages to history
                
                // --- EMIT THOUGHT & ACTION ---
                if (msg.tool_calls?.length) {
                    // Emit a general thought process if available as text content
                    if (typeof msg.content === 'string' && msg.content.trim()) {
                         res.write(`data: ${JSON.stringify({ type: 'thought', content: msg.content.trim() })}\n\n`);
                    }

                    // Emit each specific tool call as an action
                    msg.tool_calls.forEach(toolCall => {
                        // Pretty-print the JSON arguments for better readability in the UI.
                        const argsString = JSON.stringify(toolCall.args, null, 2);
                        const action = `${toolCall.name}[${argsString}]`;
                        res.write(`data: ${JSON.stringify({ type: 'action', content: action })}\n\n`);
                    });

                } else if (msg.content && typeof msg.content === 'string') {
                     try {
                        const finalJson = JSON.parse(msg.content);
                        // This is the final answer
                        res.write(`data: ${JSON.stringify({ type: 'result', content: finalJson })}\n\n`);
                    } catch (e) {
                         // This is likely a text response to a follow-up question
                         res.write(msg.content);
                    }
                }
            });
        }
        if (chunk.tools) {
            const toolMessages = chunk.tools.messages;
            const messagesArray = Array.isArray(toolMessages) ? toolMessages : [toolMessages].filter(Boolean);

            messagesArray.forEach(msg => {
                finalMessages.push(msg);
                // --- EMIT OBSERVATION ---
                res.write(`data: ${JSON.stringify({ type: 'observation', content: msg.content })}\n\n`);
            });
        }
    }
    
    // Save the complete message history for the next turn
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