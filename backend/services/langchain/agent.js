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
        // Use tools to get financial and performance data.
        const financialResultStr = await financialsTool.invoke(productData);
        const financialMetrics = JSON.parse(financialResultStr);

        const performanceResultStr = await performanceSummaryTool.invoke({
            asin: productData.asin,
            startDate: dateRange.start,
            endDate: dateRange.end,
        });

        // Check if performance data was found.
        const performanceData = performanceResultStr.startsWith("No performance data") 
            ? null 
            : JSON.parse(performanceResultStr);

        if (!performanceData) {
             return { error: "No performance data found for the given ASIN and date range." };
        }
        
        return { financialMetrics, performanceData };
    } catch (e) {
        return { error: `Failed during data gathering: ${e.message}` };
    }
};

/**
 * Node 2: Analyzes the gathered data and generates the final JSON output.
 */
const analystAndFormatNode = async (state) => {
    console.log("[Agent] ==> analystAndFormatNode");
    const { financialMetrics, performanceData, userInput } = state;
    const { ruleType } = userInput;

    // Calculate derived metrics.
    const { profitPerUnit, breakEvenAcos } = financialMetrics;
    const { total_spend, total_sales } = performanceData;
    const targetAcos = breakEvenAcos * 0.8;
    const overallAcos = total_sales > 0 ? (parseFloat(total_spend) / parseFloat(total_sales)) * 100 : 0;

    // Build a detailed prompt for the Gemini model.
    const prompt = `
        BẠN LÀ MỘT TRỢ LÝ AI CHUYÊN GIA VỀ TỐI ƯU HÓA AMAZON PPC.
        Nhiệm vụ của bạn là phân tích dữ liệu được cung cấp và đề xuất một luật tự động hóa PPC hiệu quả bằng tiếng Việt.
        Phản hồi của bạn PHẢI là một đối tượng JSON hợp lệ duy nhất, chứa 'rule' và 'reasoning'.

        LƯU Ý QUAN TRỌNG VỀ LOGIC: Hệ thống xử lý các Nhóm Điều kiện (conditionGroups) theo thứ tự từ trên xuống dưới ("First Match Wins"). Ngay khi một thực thể khớp với TẤT CẢ các điều kiện trong một nhóm, hành động của nhóm đó sẽ được thực thi và hệ thống sẽ NGỪNG xử lý. Vì vậy, hãy đặt các điều kiện cụ thể nhất hoặc mang tính "cắt lỗ" (ví dụ: giảm bid mạnh) lên trên cùng.

        Dữ liệu phân tích:
        - Chỉ số Tài chính:
          - Lợi nhuận mỗi đơn vị: $${profitPerUnit.toFixed(2)}
          - ACoS Hòa vốn: ${breakEvenAcos.toFixed(2)}%
          - ACoS Mục tiêu: ${targetAcos.toFixed(2)}%
        - Hiệu suất Tổng thể:
          - Tổng chi tiêu: $${parseFloat(total_spend).toFixed(2)}
          - Tổng doanh số: $${parseFloat(total_sales).toFixed(2)}
          - ACoS Tổng thể: ${overallAcos.toFixed(2)}%

        Yêu cầu: Dựa trên dữ liệu trên, hãy đề xuất một luật "${ruleType}".
    `;
    
    // Call the model and parse the output.
    const response = await model.invoke(prompt);
    try {
        // Use a JSON parser to ensure the output is valid.
        const parser = new JsonOutputParser();
        const result = await parser.parse(response.content);
        return { finalResult: result };
    } catch(e) {
        console.error("[Agent] LLM output parsing failed:", e.message);
        console.error("[Agent] Raw LLM output:", response.content);
        return { error: `Failed to parse final result from LLM. Raw output: ${response.content}` }
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
workflow.addNode("analyst", analystAndFormatNode);

// Define the workflow connections
workflow.setEntryPoint("gatherData");
workflow.addConditionalEdges("gatherData", dataCheckEdge, {
    analyze: "analyst",
    end: END,
});
workflow.addEdge("analyst", END);

// Compile the graph into a runnable application.
export const agentApp = workflow.compile();