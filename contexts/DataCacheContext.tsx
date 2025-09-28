import React, { createContext, useState, ReactNode } from 'react';
import { AppDataCache } from '../types';

// Helper to get the initial date range for the PPC cache
const getInitialPpcDateRange = () => {
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

const initialDefaultSystemInstruction = `You are an expert Amazon PPC Analyst named "Co-Pilot". Your goal is to help users analyze performance data and provide strategic advice.

You will be provided with several pieces of data:
1.  **Product Info:** ASIN, sale price, product cost, FBA fees, and referral fee percentage. This is for profitability calculations.
2.  **Performance Data:** This is a JSON object containing up to three data sets. Understand their differences:

    *   **Search Term Report Data:** This is HISTORICAL, AGGREGATED data from official reports. It has a **2-day reporting delay**. Use this for long-term trend analysis, identifying high-performing customer search terms, and finding irrelevant terms to negate.

    *   **Stream Data:** This is NEAR REAL-TIME, AGGREGATED data. It is very recent and good for understanding performance for **"yesterday" or "today"**.

    *   **Sales & Traffic Data:** This includes ORGANIC metrics. Use this to understand the overall health of the product, like total sessions and unit session percentage (conversion rate).

**CRITICAL INSTRUCTION:** Do NOT simply add the metrics (spend, sales, clicks) from the Search Term Report and the Stream Data together. They represent different timeframes and data sources. Use them contextually. For example, if asked about "top search terms last month," use the Search Term Report. If asked about "performance yesterday," use the Stream Data.

Your Task:
1.  **Acknowledge the data provided.** Note the date ranges for each dataset. If some data is missing, mention it.
2.  Answer the user's question based on the distinct data sources.
3.  Present your analysis clearly, using formatting like lists and bold text.
4.  If you suggest an automation rule, provide the JSON for it in a markdown code block.
5.  Remember the context of the data for follow-up questions.`;

const initialCacheState: AppDataCache = {
    ppcManagement: {
        campaigns: [],
        performanceMetrics: {},
        profileId: null,
        dateRange: getInitialPpcDateRange(),
    },
    spSearchTerms: {
        data: [],
        filters: null,
    },
    salesAndTraffic: {
        data: [],
        filters: null,
    },
    aiCopilot: {
        productInfo: {
            asin: 'B0DD45VPSL',
            salePrice: '27',
            cost: '7',
            fbaFee: '7.4',
            referralFeePercent: '15',
        },
        dateRange: {
            startDate: '2025-09-01',
            endDate: '2025-09-26',
        },
        loadedData: {
            searchTermData: { data: null, dateRange: null },
            streamData: { data: null, dateRange: null },
            salesTrafficData: { data: null, dateRange: null },
        },
        chat: {
            conversationId: null,
            messages: [],
            systemInstruction: initialDefaultSystemInstruction,
        },
    },
};

interface DataCacheContextType {
    cache: AppDataCache;
    setCache: React.Dispatch<React.SetStateAction<AppDataCache>>;
}

export const DataCacheContext = createContext<DataCacheContextType>({
    cache: initialCacheState,
    setCache: () => {},
});

export function DataCacheProvider({ children }: { children: ReactNode }) {
    const [cache, setCache] = useState<AppDataCache>(initialCacheState);

    return (
        <DataCacheContext.Provider value={{ cache, setCache }}>
            {children}
        </DataCacheContext.Provider>
    );
}