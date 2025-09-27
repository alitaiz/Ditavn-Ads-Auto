import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';

const router = express.Router();

// Fix: Initialize the GoogleGenAI client. Ensure API_KEY is set in your environment variables.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const ruleSuggestionSchema = {
    type: Type.OBJECT,
    properties: {
        name: {
            type: Type.STRING,
            description: "A descriptive name for the automation rule."
        },
        conditionGroups: {
            type: Type.ARRAY,
            description: "An array of IF/THEN logic blocks. The first one that matches wins.",
            items: {
                type: Type.OBJECT,
                properties: {
                    conditions: {
                        type: Type.ARRAY,
                        description: "A list of conditions that must ALL be true (AND logic).",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                metric: {
                                    type: Type.STRING,
                                    description: "The performance metric to evaluate. Must be one of: 'spend', 'sales', 'acos', 'orders', 'clicks', 'impressions'."
                                },
                                timeWindow: {
                                    type: Type.NUMBER,
                                    description: "The lookback period in days (1-90)."
                                },
                                operator: {
                                    type: Type.STRING,
                                    description: "The comparison operator. Must be '>', '<', or '='."
                                },
                                value: {
                                    type: Type.NUMBER,
                                    description: "The threshold value to compare against. For ACOS, use a decimal (e.g., 0.4 for 40%)."
                                }
                            },
                            required: ["metric", "timeWindow", "operator", "value"]
                        }
                    },
                    action: {
                        type: Type.OBJECT,
                        description: "The action to take if all conditions are met.",
                        properties: {
                            type: {
                                type: Type.STRING,
                                description: "The type of action. Must be one of: 'adjustBidPercent', 'negateSearchTerm'."
                            },
                            value: {
                                type: Type.NUMBER,
                                description: "The value for the action. For 'adjustBidPercent', it's a percentage (e.g., -10 for -10%). Not used for 'negateSearchTerm'."
                            },
                            matchType: {
                                type: Type.STRING,
                                description: "For 'negateSearchTerm' action. Must be 'NEGATIVE_EXACT' or 'NEGATIVE_PHRASE'."
                            },
                            minBid: {
                                type: Type.NUMBER,
                                description: "Optional minimum bid for 'adjustBidPercent'."
                            },
                            maxBid: {
                                type: Type.NUMBER,
                                description: "Optional maximum bid for 'adjustBidPercent'."
                            }
                        },
                        required: ["type"]
                    }
                },
                required: ["conditions", "action"]
            }
        }
    },
    required: ["name", "conditionGroups"]
};

router.post('/ai/suggest-rule', async (req, res) => {
    const { goal, ruleType } = req.body;
    if (!goal || !ruleType) {
        return res.status(400).json({ error: 'Goal and ruleType are required.' });
    }

    try {
        const prompt = `
            You are an expert Amazon PPC automation strategist. Your task is to generate a single, specific automation rule configuration based on a user's high-level goal.
            The rule you create will be for Sponsored Products (SP) campaigns.

            User's Goal: "${goal}"
            Rule Type: "${ruleType}"

            Instructions:
            1.  Analyze the user's goal and the rule type.
            2.  Create a JSON object that represents a logical rule to achieve this goal.
            3.  The JSON object must strictly adhere to the provided schema.
            4.  For 'timeWindow', choose a reasonable number of days (e.g., 7, 14, 30, 60).
            5.  For 'metric', use one of: 'spend', 'sales', 'acos', 'orders', 'clicks', 'impressions'.
            6.  For ACOS 'value', use a decimal representation (e.g., 0.4 for 40% ACOS).
            7.  For 'action.type', use one of: 'adjustBidPercent', 'negateSearchTerm'.
            8.  For 'adjustBidPercent', 'value' is a percentage (e.g., -15 for -15%). A negative value decreases the bid, a positive value increases it.
            9.  For 'negateSearchTerm', 'matchType' must be 'NEGATIVE_EXACT' or 'NEGATIVE_PHRASE'.
            10. Provide a concise, descriptive 'name' for the rule.
            11. Be logical. For example, a rule to negate unprofitable search terms should look at high spend and zero sales. A rule to reduce ACOS should lower bids on high-ACOS keywords.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: ruleSuggestionSchema,
            },
        });

        const jsonText = response.text.trim();
        const suggestion = JSON.parse(jsonText);
        res.json(suggestion);

    } catch (error) {
        console.error("Gemini API error:", error);
        res.status(500).json({ error: "Failed to get suggestion from AI." });
    }
});

export default router;
