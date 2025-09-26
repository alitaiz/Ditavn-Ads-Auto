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
        // The tools expect a single JSON string as input.
        const financialInput = {
            salePrice: productData.salePrice,
            productCost: productData.productCost,
            fbaFee: productData.fbaFee,
            referralFeePercent: productData.referralFeePercent,
        };
        const financialResultStr = await financialsTool.invoke(JSON.stringify(financialInput));
        const financialMetrics = JSON.parse(financialResultStr);

        const performanceInput = {
            asin: productData.asin,
            startDate: dateRange.start,
            endDate: dateRange.end,
        };
        const performanceResultStr = await performanceSummaryTool.invoke(JSON.stringify(performanceInput));

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
        BẠN LÀ MỘT TRỢ LÝ AI CHUYÊN GIA VỀ TỐI ƯU HÓA AMAZON PPC VỚI NHIỀU NĂM KINH NGHIỆM.
        Nhiệm vụ của bạn là thực hiện một phân tích chi tiết theo từng bước và đề xuất một luật tự động hóa PPC thông minh.

        **Bối cảnh:**
        - Sản phẩm có các chỉ số tài chính sau:
            - Lợi nhuận mỗi đơn vị: $${profitPerUnit.toFixed(2)}
            - ACoS Hòa vốn: ${breakEvenAcos.toFixed(2)}% (Đây là mức ACoS tối đa để không bị lỗ)
            - ACoS Mục tiêu: ${targetAcos.toFixed(2)}% (Mức ACoS lý tưởng để có lợi nhuận)
        - Hiệu suất tổng thể trong khoảng thời gian đã chọn:
            - Tổng chi tiêu quảng cáo: $${parseFloat(total_spend).toFixed(2)}
            - Tổng doanh số từ quảng cáo: $${parseFloat(total_sales).toFixed(2)}
            - ACoS Tổng thể: ${overallAcos.toFixed(2)}%

        **Quy trình Phân tích (Hãy suy nghĩ theo các bước sau):**
        1.  **So sánh Hiệu suất:** So sánh ACoS Tổng thể (${overallAcos.toFixed(2)}%) với ACoS Mục tiêu (${targetAcos.toFixed(2)}%) và ACoS Hòa vốn (${breakEvenAcos.toFixed(2)}%). Hiệu suất hiện tại đang tốt, xấu, hay rất xấu?
        2.  **Xác định Vấn đề Cốt lõi:** Dựa trên so sánh ở bước 1, vấn đề chính là gì? (Ví dụ: "ACoS hiện tại cao hơn nhiều so với mục tiêu, cho thấy chi tiêu quảng cáo chưa hiệu quả", hoặc "ACoS thấp hơn mục tiêu, có cơ hội để tăng bid và mở rộng quy mô").
        3.  **Đề xuất Giải pháp:** Dựa trên vấn đề, đề xuất một chiến lược chung. (Ví dụ: "Cần một luật để cắt giảm chi tiêu lãng phí cho các từ khóa không hiệu quả", hoặc "Cần một luật để tăng bid cho các từ khóa đang hoạt động tốt").
        4.  **Xây dựng Rule Chi tiết:** Dựa trên chiến lược, tạo ra một rule cụ thể. Hãy giải thích tại sao bạn chọn các chỉ số, khoảng thời gian và giá trị cụ thể trong rule. Sử dụng nguyên tắc "First Match Wins" bằng cách đặt các điều kiện nghiêm ngặt nhất (ví dụ: cắt lỗ) lên trên.
        5.  **Tạo JSON Output:** Dựa trên các bước trên, tạo ra đối tượng JSON cuối cùng.

        **Yêu cầu:** Hãy tạo một luật loại "${ruleType}".
        
        **Output:** Phản hồi của bạn PHẢI là một đối tượng JSON hợp lệ duy nhất, chứa hai khóa:
        1.  **"rule"**: Một đối tượng JSON chứa cấu hình rule tự động hóa.
        2.  **"reasoning"**: Một chuỗi (string) giải thích chi tiết quy trình suy nghĩ của bạn (bao gồm các bước 1-4 ở trên) bằng tiếng Việt.
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