// backend/routes/ai.js
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const conversations = new Map(); // In-memory conversation store for Chat objects

// This is the "brain" of the AI, priming it with knowledge about our system.
const systemInstruction = `
You are an expert Amazon PPC strategist and data analyst, acting as an AI Co-Pilot.
Your goal is to assist users by analyzing the data they provide and answering their questions about PPC strategy.
When asked to create an automation rule, you MUST strictly adhere to the following JSON structure for the 'config' part of the rule. Do not invent new metrics, operators, or action types.

// --- RULE STRUCTURE DEFINITION ---

// A rule is composed of one or more condition groups.
// They are evaluated in order ("first match wins").
interface AutomationConditionGroup {
    conditions: AutomationRuleCondition[];
    action: AutomationRuleAction;
}

// A single condition within a group. ALL conditions in a group must be met.
interface AutomationRuleCondition {
    // AVAILABLE METRICS:
    // 'spend', 'sales', 'acos', 'orders', 'clicks', 'impressions', 'roas', 'budgetUtilization'
    metric: 'spend' | 'sales' | 'acos' | 'orders' | 'clicks' | 'impressions' | 'roas' | 'budgetUtilization';
    
    // Time window in days. 'TODAY' is only for 'budgetUtilization' and ROAS/ACoS in budget rules.
    timeWindow: number | 'TODAY'; 
    
    // AVAILABLE OPERATORS: '>', '<', '='
    operator: '>' | '<' | '=';
    
    value: number;
}

// An action to be taken if conditions are met.
interface AutomationRuleAction {
    // AVAILABLE ACTION TYPES:
    // 'adjustBidPercent', 'negateSearchTerm', 'increaseBudgetPercent', 'setBudgetAmount'
    type: 'adjustBidPercent' | 'negateSearchTerm' | 'increaseBudgetPercent' | 'setBudgetAmount';
    
    value?: number; // e.g., -10 for decrease by 10%, 50 for increase by 50%
    
    // For 'negateSearchTerm' action
    matchType?: 'NEGATIVE_EXACT' | 'NEGATIVE_PHRASE';
    
    // For 'adjustBidPercent' action
    minBid?: number;
    maxBid?: number;
}

// --- END OF RULE STRUCTURE DEFINITION ---

When responding, be helpful and conversational. If you provide a rule, explain your reasoning clearly.
`;

router.post('/ai/start-chat', async (req, res) => {
    const { contextData, initialQuestion } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const conversationId = uuidv4();

    const firstUserMessage = `
Here is the context data I have prepared:
--- CONTEXT DATA START ---
${contextData}
--- CONTEXT DATA END ---

Based on that data, here is my question: ${initialQuestion}
`;

    try {
        const chat = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: { systemInstruction },
            history: [{ role: 'user', parts: [{ text: firstUserMessage }] }],
        });

        conversations.set(conversationId, chat);
        res.write(`data: ${JSON.stringify({ type: 'conversationStart', content: { conversationId } })}\n\n`);

        const responseStream = await chat.sendMessageStream({ message: initialQuestion });

        for await (const chunk of responseStream) {
            if (chunk.text) {
                res.write(`data: ${JSON.stringify({ type: 'text_chunk', content: chunk.text })}\n\n`);
            }
        }
    } catch (e) {
        console.error('[AI Chat Start] Error:', e);
        res.write(`data: ${JSON.stringify({ type: 'error', content: e.message })}\n\n`);
    } finally {
        res.end();
    }
});

router.post('/ai/send-message', async (req, res) => {
    const { conversationId, message } = req.body;

    if (!conversationId || !conversations.has(conversationId)) {
        return res.status(404).json({ error: "Conversation not found." });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const chat = conversations.get(conversationId);
        const responseStream = await chat.sendMessageStream({ message });

        for await (const chunk of responseStream) {
            if (chunk.text) {
                res.write(`data: ${JSON.stringify({ type: 'text_chunk', content: chunk.text })}\n\n`);
            }
        }
    } catch (e) {
        console.error('[AI Chat Send] Error:', e);
        res.write(`data: ${JSON.stringify({ type: 'error', content: e.message })}\n\n`);
    } finally {
        res.end();
    }
});

export default router;