// backend/services/langchain/agent.js
import { StateGraph, END } from "@langchain/langgraph";
import { AIMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { financialsTool, performanceSummaryTool } from "./tools.js";
import { ToolExecutor } from "@langchain/langgraph/prebuilt";

// --- Agent Definition ---

// 1. Define the tools the agent can use.
const tools = [financialsTool, performanceSummaryTool];
const toolExecutor = new ToolExecutor({ tools });

// 2. Define the model and bind the tools to it.
const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY
}).bindTools(tools);

// 3. Define the Agent's State. It's a list of messages that serves as its memory.
const agentState = {
    messages: {
        value: (x, y) => x.concat(y),
        default: () => [],
    },
};

// --- Agent Nodes ---

// Node 1: The "Agent" or "Brain"
const agentNode = async (state) => {
    console.log("[Agent] ==> agentNode (The Brain)");
    const { messages } = state;
    const response = await model.invoke(messages);
    return { messages: [response] };
};

// Node 2: The "Tool Executor" or "Hands"
const toolNode = async (state) => {
    console.log("[Agent] ==> toolNode (The Hands)");
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];
    const toolCalls = lastMessage.tool_calls;
    const toolExecutorResponse = await toolExecutor.invoke({ tool_calls: toolCalls });
    return { messages: toolExecutorResponse.tool_messages };
};

// --- Graph Definition ---

const shouldContinue = (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    return lastMessage.tool_calls?.length ? "continue" : "end";
};

const workflow = new StateGraph({ channels: agentState });

workflow.addNode("agent", agentNode);
workflow.addNode("tools", toolNode);
workflow.setEntryPoint("agent");
workflow.addConditionalEdges("agent", shouldContinue, { continue: "tools", end: END });
workflow.addEdge("tools", "agent");

// Update the system prompt to handle follow-up questions.
const systemMessage = new HumanMessage(`
    You are an expert Amazon PPC Analyst AI. Your goal is to help users create effective automation rules.
    Follow these steps for the initial request:
    1.  First, use the 'ProductFinancialsCalculator' tool to understand the product's profitability (break-even ACoS).
    2.  Next, use the 'Get_PPC_Performance_Summary' tool to get the actual performance data for the product's ASIN from the database.
    3.  Once you have both financial and performance data, analyze the situation. Compare the actual ACoS to the break-even ACoS.
    4.  Your response to this initial analysis MUST be a single, valid JSON object with two keys: "rule" (containing the rule configuration as a JSON object) and "reasoning" (a detailed explanation in Vietnamese of why you created this rule). Do not add any other text or formatting.
    
    After you have provided the JSON response, the user may ask follow-up questions. Answer these questions concisely and helpfully, using the data you have already gathered as context. Do not call tools again unless specifically asked for new information.
`);

export const agentApp = workflow.compile().withConfig({
    prepend: (input) => ({ messages: [systemMessage, ...input.messages] }),
});