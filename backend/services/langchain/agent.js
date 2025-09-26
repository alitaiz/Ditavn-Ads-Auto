// backend/services/langchain/agent.js
import { StateGraph, END } from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
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

// Node 1: The "Agent" or "Brain" - Decides what to do next.
const agentNode = async (state) => {
    console.log("[Agent] ==> agentNode (The Brain)");
    const { messages } = state;
    const response = await model.invoke(messages);
    return { messages: [response] };
};

// Node 2: The "Tool Executor" or "Hands" - Runs the tools.
const toolNode = async (state) => {
    console.log("[Agent] ==> toolNode (The Hands)");
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];

    // The `ToolExecutor` from `@langchain/langgraph/prebuilt` is designed to
    // be called with an AIMessage and it returns an array of ToolMessages.
    const toolMessages = await toolExecutor.invoke(lastMessage);

    return { messages: toolMessages };
};


// --- Graph Definition ---

// This function determines whether to continue with tool execution or end the cycle.
const shouldContinue = (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    // If the last message has tool calls, we continue. Otherwise, we end.
    return lastMessage.tool_calls?.length ? "continue" : "end";
};

// Create the graph instance.
const workflow = new StateGraph({ channels: agentState });

// Add the nodes to the graph.
workflow.addNode("agent", agentNode);
workflow.addNode("tools", toolNode);

// Set the entry point for the graph.
workflow.setEntryPoint("agent");

// Add the conditional logic for routing.
workflow.addConditionalEdges("agent", shouldContinue, { continue: "tools", end: END });

// Add the edge that loops back from the tools to the agent.
workflow.addEdge("tools", "agent");

const systemMessage = new SystemMessage(`
    You are an expert Amazon PPC Analyst AI. Your goal is to help users create effective automation rules. Your thought process and responses should be in Vietnamese.

    **Initial Request Protocol:**
    1.  **Step 1: Think.** First, you MUST output your thought process as a single sentence explaining what data you need and which tools you will call to get it. For example: "Tôi cần tính toán các chỉ số tài chính và lấy dữ liệu hiệu suất của sản phẩm."
    2.  **Step 2: Act.** After thinking, call the 'ProductFinancialsCalculator' and 'Get_PPC_Performance_Summary' tools in parallel to gather all necessary data.
    3.  **Step 3: STOP.** After receiving responses from these tools, you MUST STOP using tools.
    4.  **Step 4: Analyze & Respond.** Based on the tool outputs, generate your final response.
        -   **Case A: Performance Data Found:** Analyze the data, compare the actual ACoS (total_spend / total_sales) to the break-even ACoS, and formulate a specific, data-driven rule.
        -   **Case B: "No performance data found":** If the performance tool returned this message, your reasoning must state that no data was available for analysis and the suggested rule is a general placeholder.
    5.  **Final Output Format:** Your response MUST be a single, valid JSON object with two keys: "rule" (containing the rule configuration as a JSON object) and "reasoning" (a detailed explanation in Vietnamese of your analysis and why you created this rule). Do not add any other text, formatting, or markdown.

    **Follow-up Questions:**
    -   After providing the initial JSON response, the user may ask follow-up questions. Answer these questions concisely and helpfully in Vietnamese, using the data you have already gathered as context. Do not call tools again unless specifically asked for new information.
`);

// Compile the graph into a runnable application, prepending the system message to every run.
export const agentApp = workflow.compile().withConfig({
    prepend: (input) => ({ messages: [systemMessage, ...input.messages] }),
});