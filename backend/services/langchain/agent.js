// backend/services/langchain/agent.js
import { StateGraph, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { financialsTool, performanceSummaryTool } from "./tools.js";

// Define the state for our agent. This object will be passed between nodes.
const agentState = {
    userInput: { value: null },
    financialMetrics: { value: null },
    performanceData: { value: null },
    analysis: { value: null }, // NEW: To store intermediate analysis
    strategy: { value: null }, // NEW: To store intermediate strategy
    finalResult: { value: null },
    error: { value: null },
};

// Initialize the Gemini model we'll be using for analysis.
const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY
});

// --- Agent Nodes ---

/**
 * Node 1: Gathers all necessary data using the defined tools.
 */
const gatherDataNode = async (state) => {
    console.log("[Agent] ==> gatherDataNode");
    const { productData, dateRange } = state.userInput;

    try {
        const financialInput = JSON.stringify({
            salePrice: productData.salePrice, productCost: productData.productCost,
            fbaFee: productData.fbaFee, referralFeePercent: productData.referralFeePercent,
        });
        const financialResultStr = await financialsTool.invoke(financialInput);
        const financialMetrics = JSON.parse(financialResultStr);
        financialMetrics.targetAcos = financialMetrics.breakEvenAcos * 0.8;

        const performanceInput = JSON.stringify({
            asin: productData.asin, startDate: dateRange.start, endDate: dateRange.end,
        });
        const performanceResultStr = await performanceSummaryTool.invoke(performanceInput);
        
        if (performanceResultStr.startsWith("No performance data")) {
             return { error: performanceResultStr };
        }
        const performanceData = JSON.parse(performanceResultStr);
        
        return { financialMetrics, performanceData };
    } catch (e) {
        return { error: `Failed during data gathering: ${e.message}` };
    }
};

/**
 * Node 2: Analyzes performance against goals.
 */
const analyzePerformanceNode = async (state) => {
    console.log("[Agent] ==> analyzePerformanceNode");
    const { financialMetrics, performanceData } = state;

    const overallAcos = parseFloat(performanceData.total_sales) > 0 
        ? (parseFloat(performanceData.total_spend) / parseFloat(performanceData.total_sales)) * 100 
        : (parseFloat(performanceData.total_spend) > 0 ? Infinity : 0);

    const prompt = `
        Analyze the following PPC data. Compare the overall ACoS to the target and break-even ACoS.
        Concisely state the core problem or opportunity in one or two sentences in Vietnamese.

        - Break-Even ACoS: ${financialMetrics.breakEvenAcos.toFixed(2)}%
        - Target ACoS: ${financialMetrics.targetAcos.toFixed(2)}%
        - Overall ACoS: ${overallAcos.toFixed(2)}%
    `;
    const response = await model.invoke(prompt);
    return { analysis: response.content };
};

/**
 * Node 3: Formulates a high-level strategy.
 */
const strategizeNode = async (state) => {
    console.log("[Agent] ==> strategizeNode");
    const { analysis, userInput } = state;
    const { ruleType } = userInput;

    const prompt = `
        Based on this analysis: "${analysis}".
        What is the high-level strategy to create a "${ruleType}" rule to address this?
        Respond in one or two sentences in Vietnamese.
    `;
    const response = await model.invoke(prompt);
    return { strategy: response.content };
};

/**
 * Node 4: Constructs the final rule and detailed reasoning.
 */
const constructRuleNode = async (state) => {
    console.log("[Agent] ==> constructRuleNode");
    const { financialMetrics, performanceData, analysis, strategy, userInput } = state;
    const { ruleType } = userInput;

    const prompt = `
        BẠN LÀ MỘT TRỢ LÝ AI CHUYÊN GIA VỀ TỐI ƯU HÓA AMAZON PPC.
        
        **Bối cảnh:**
        - **Phân tích ban đầu:** ${analysis}
        - **Chiến lược đã xác định:** ${strategy}
        - **Dữ liệu tài chính:** ${JSON.stringify(financialMetrics)}
        - **Dữ liệu hiệu suất:** ${JSON.stringify(performanceData)}

        **Yêu cầu:**
        Dựa trên tất cả thông tin trên, hãy xây dựng một rule tự động hóa loại "${ruleType}" cụ thể và chi tiết.
        
        **Output:** Phản hồi của bạn PHẢI là một đối tượng JSON hợp lệ duy nhất, chứa hai khóa:
        1.  **"rule"**: Một đối tượng JSON chứa cấu hình rule tự động hóa (chỉ có name, rule_type, và config).
        2.  **"reasoning"**: Một chuỗi (string) giải thích chi tiết logic đằng sau rule bạn vừa tạo, tại sao bạn chọn các chỉ số và giá trị đó. Viết bằng tiếng Việt.
    `;
    
    const response = await model.invoke(prompt);
    try {
        const parser = new JsonOutputParser();
        const result = await parser.parse(response.content);
        return { finalResult: result };
    } catch(e) {
        return { error: `Failed to parse final rule from LLM. Raw output: ${response.content}` };
    }
};

// --- Graph Definition ---

/**
 * Conditional Edge: Decides the next step after data gathering.
 */
const dataCheckEdge = (state) => {
    if (state.error || !state.performanceData) {
        console.log("[Agent] Edge: Data check failed or no data. Ending graph.");
        return "end";
    }
    console.log("[Agent] Edge: Data found. Proceeding to analysis.");
    return "analyze";
};

const workflow = new StateGraph({ channels: agentState });

// Add nodes to the graph
workflow.addNode("gatherData", gatherDataNode);
workflow.addNode("analyzePerformance", analyzePerformanceNode);
workflow.addNode("strategize", strategizeNode);
workflow.addNode("constructRule", constructRuleNode);

// Define the workflow connections
workflow.setEntryPoint("gatherData");
workflow.addConditionalEdges("gatherData", dataCheckEdge, {
    analyze: "analyzePerformance",
    end: END,
});
workflow.addEdge("analyzePerformance", "strategize");
workflow.addEdge("strategize", "constructRule");
workflow.addEdge("constructRule", END);

// Compile the graph into a runnable application.
export const agentApp = workflow.compile();