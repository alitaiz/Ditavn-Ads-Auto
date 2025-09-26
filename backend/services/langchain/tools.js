// backend/services/langchain/tools.js
import { DynamicTool } from "@langchain/core/tools";
import pool from "../../db.js";

/**
 * A tool that calculates financial metrics for a product.
 * It's used by the AI agent to understand the product's profitability.
 */
export const financialsTool = new DynamicTool({
    name: "ProductFinancialsCalculator",
    description: "Calculates break-even ACOS and profit per unit for a given product's financial data. Input is an object with salePrice, productCost, fbaFee, and referralFeePercent.",
    func: async ({ salePrice, productCost, fbaFee, referralFeePercent }) => {
        try {
            const referralFee = salePrice * (referralFeePercent / 100);
            const profitPerUnit = salePrice - productCost - fbaFee - referralFee;
            const breakEvenAcos = profitPerUnit > 0 ? (profitPerUnit / salePrice) * 100 : 0;
            return JSON.stringify({ profitPerUnit, breakEvenAcos });
        } catch (e) {
            return `Error calculating financials: ${e.message}. Input must be a valid object.`;
        }
    },
});

/**
 * A tool that allows the AI agent to safely query the database for PPC performance data.
 * It does not execute arbitrary SQL, ensuring security.
 */
export const performanceSummaryTool = new DynamicTool({
    name: "Get_PPC_Performance_Summary",
    description: `Retrieves an aggregated summary of PPC performance (total spend, sales, clicks, orders) for a specific ASIN within a date range from the historical reports database. Input is an object: { "asin": "B0...", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }.`,
    func: async ({ asin, startDate, endDate }) => {
        try {
            // This query aggregates performance data from the SP search term report table.
            // It's a safe, parameterized query that prevents SQL injection.
            const query = `
                SELECT
                    SUM(cost) AS total_spend,
                    SUM(sales_7d) AS total_sales,
                    SUM(clicks) AS total_clicks,
                    SUM(purchases_7d) AS total_orders
                FROM sponsored_products_search_term_report
                WHERE asin = $1 AND report_date BETWEEN $2 AND $3;
            `;
            const result = await pool.query(query, [asin, startDate, endDate]);
            
            if (result.rows.length > 0 && result.rows[0].total_spend !== null) {
                return JSON.stringify(result.rows[0]);
            }
            return "No performance data found for the given ASIN and date range in historical reports.";
        } catch(e) {
            return `Error querying database: ${e.message}.`;
        }
    }
});