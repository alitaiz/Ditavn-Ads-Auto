// views/AICopilotView.tsx
import React, { useState, useRef, useEffect, useContext } from 'react';
import { marked } from 'marked';
import { DataCacheContext } from '../contexts/DataCacheContext';
import { ChatMessage, AICopilotCache } from '../types';

const styles: { [key: string]: React.CSSProperties } = {
    container: { display: 'grid', gridTemplateColumns: '40% 60%', gap: '20px', height: 'calc(100vh - 100px)', padding: '20px' },
    leftPanel: { display: 'flex', flexDirection: 'column', gap: '15px', padding: '20px', backgroundColor: 'var(--card-background-color)', borderRadius: 'var(--border-radius)', boxShadow: 'var(--box-shadow)', overflowY: 'auto' },
    rightPanel: { display: 'flex', flexDirection: 'column', backgroundColor: 'var(--card-background-color)', borderRadius: 'var(--border-radius)', boxShadow: 'var(--box-shadow)' },
    formGroup: { display: 'flex', flexDirection: 'column', gap: '5px' },
    label: { fontWeight: 500, fontSize: '0.9rem' },
    input: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '1rem' },
    dateInputContainer: { display: 'flex', gap: '10px' },
    toolCard: { border: '1px solid var(--border-color)', borderRadius: '8px', padding: '15px', backgroundColor: '#f8f9fa' },
    toolHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
    toolTitle: { margin: 0, fontSize: '1.1rem' },
    toolButton: { padding: '8px 12px', border: '1px solid var(--primary-color)', color: 'var(--primary-color)', background: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 },
    toolStatus: { fontSize: '0.8rem', color: '#666', fontStyle: 'italic' },
    chatWindow: { flex: 1, padding: '20px', overflowY: 'auto', borderBottom: '1px solid var(--border-color)' },
    chatInputForm: { display: 'flex', padding: '10px', gap: '10px' },
    chatInput: { flex: 1, padding: '10px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '1rem' },
    sendButton: { padding: '10px 20px', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' },
    message: { marginBottom: '15px', padding: '10px 15px', borderRadius: '10px', maxWidth: '85%' },
    userMessage: { backgroundColor: '#e6f7ff', alignSelf: 'flex-end', borderBottomRightRadius: '0px' },
    aiMessage: { backgroundColor: '#f0f2f2', alignSelf: 'flex-start', borderBottomLeftRadius: '0px' },
    thinking: { fontStyle: 'italic', color: '#666', padding: '5px 0' },
    error: { color: 'var(--danger-color)', fontSize: '0.9rem', marginTop: '5px' },
};

export function AICopilotView() {
    const { cache, setCache } = useContext(DataCacheContext);
    const aiCache = cache.aiCopilot;

    const updateAiCache = (updater: (prev: AICopilotCache) => AICopilotCache) => {
        setCache(prevCache => ({
            ...prevCache,
            aiCopilot: updater(prevCache.aiCopilot),
        }));
    };

    const setProductInfo = (key: keyof AICopilotCache['productInfo'], value: string) => {
        updateAiCache(prev => ({ ...prev, productInfo: { ...prev.productInfo, [key]: value } }));
    };

    const setDateRange = (key: keyof AICopilotCache['dateRange'], value: string) => {
        updateAiCache(prev => ({ ...prev, dateRange: { ...prev.dateRange, [key]: value } }));
    };

    const setLoadedData = (key: keyof AICopilotCache['loadedData'], data: any[] | null) => {
        updateAiCache(prev => ({ ...prev, loadedData: { ...prev.loadedData, [key]: data } }));
    };

    const [loading, setLoading] = useState({ st: false, stream: false, sat: false, chat: false });
    const [error, setError] = useState({ st: '', stream: '', sat: '', chat: '' });
    const [currentQuestion, setCurrentQuestion] = useState('');
    
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [aiCache.chat.messages]);

    const handleLoadData = async (tool: 'st' | 'stream' | 'sat') => {
        setLoading(prev => ({ ...prev, [tool]: true }));
        setError(prev => ({ ...prev, [tool]: '' }));
        
        let endpoint = '';
        let setDataFunc: (data: any[] | null) => void;

        switch (tool) {
            case 'st': 
                endpoint = '/api/ai/tool/search-term';
                setDataFunc = (data) => setLoadedData('searchTermData', data);
                break;
            case 'stream':
                endpoint = '/api/ai/tool/stream';
                setDataFunc = (data) => setLoadedData('streamData', data);
                break;
            case 'sat':
                endpoint = '/api/ai/tool/sales-traffic';
                setDataFunc = (data) => setLoadedData('salesTrafficData', data);
                break;
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    asin: aiCache.productInfo.asin, 
                    startDate: aiCache.dateRange.startDate, 
                    endDate: aiCache.dateRange.endDate 
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to load data.');
            setDataFunc(data);
        } catch (err) {
            setError(prev => ({ ...prev, [tool]: err instanceof Error ? err.message : 'An unknown error occurred' }));
        } finally {
            setLoading(prev => ({ ...prev, [tool]: false }));
        }
    };

    const handleViewData = (tool: 'st' | 'stream' | 'sat') => {
        let dataToView: any[] | null = null;
        switch(tool) {
            case 'st': dataToView = aiCache.loadedData.searchTermData; break;
            case 'stream': dataToView = aiCache.loadedData.streamData; break;
            case 'sat': dataToView = aiCache.loadedData.salesTrafficData; break;
        }

        if (dataToView && dataToView.length > 0) {
            const key = `ai-data-viewer-${tool}-${Date.now()}`;
            sessionStorage.setItem(key, JSON.stringify(dataToView));
            window.open(`#/data-viewer/${key}`, '_blank');
        }
    };

    const handleStartConversation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentQuestion.trim()) return;

        const questionToAsk = currentQuestion;
        const newUserMessage: ChatMessage = { id: Date.now(), sender: 'user', text: questionToAsk };

        updateAiCache(prev => ({
            ...prev,
            chat: { ...prev.chat, messages: [...prev.chat.messages, newUserMessage] }
        }));
        
        setLoading(prev => ({...prev, chat: true}));
        setError(prev => ({...prev, chat: ''}));
        setCurrentQuestion('');

        try {
            const payload = {
                question: questionToAsk,
                conversationId: aiCache.chat.conversationId,
                context: {
                    productInfo: aiCache.productInfo,
                    performanceData: aiCache.loadedData
                }
            };

            const response = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.body) throw new Error("Streaming response not available.");
            if (!response.ok) throw new Error((await response.json()).error);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let aiResponseText = '';
            let isFirstChunk = true;
            let currentAiMessageId = Date.now() + 1;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim() !== '');

                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.error) throw new Error(parsed.error);

                        if (isFirstChunk) {
                            isFirstChunk = false;
                            updateAiCache(prev => {
                                const newConversationId = parsed.conversationId || prev.chat.conversationId;
                                const newAiMessagePlaceholder: ChatMessage = { id: currentAiMessageId, sender: 'ai', text: '' };
                                return {
                                    ...prev,
                                    chat: {
                                        ...prev.chat,
                                        conversationId: newConversationId,
                                        messages: [...prev.chat.messages, newAiMessagePlaceholder]
                                    }
                                };
                            });
                        }

                        if (parsed.content) {
                            aiResponseText += parsed.content;
                            updateAiCache(prev => ({
                                ...prev,
                                chat: {
                                    ...prev.chat,
                                    messages: prev.chat.messages.map(msg => 
                                        msg.id === currentAiMessageId ? { ...msg, text: aiResponseText } : msg
                                    )
                                }
                            }));
                        }
                    } catch (e) {
                         console.error("Error parsing stream chunk:", line, e);
                         setError(prev => ({...prev, chat: `Stream parsing error: ${line}`}));
                    }
                }
            }
        } catch (err) {
            setError(prev => ({...prev, chat: err instanceof Error ? err.message : 'An unknown error occurred'}));
        } finally {
             setLoading(prev => ({...prev, chat: false}));
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.leftPanel}>
                <h2>AI Co-Pilot Control Panel</h2>
                <div style={styles.formGroup}>
                    <label style={styles.label}>ASIN</label>
                    <input style={styles.input} value={aiCache.productInfo.asin} onChange={e => setProductInfo('asin', e.target.value)} placeholder="e.g., B0DD45VPSL" />
                </div>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px'}}>
                    <div style={styles.formGroup}><label style={styles.label}>Sale Price</label><input type="number" style={styles.input} value={aiCache.productInfo.salePrice} onChange={e => setProductInfo('salePrice', e.target.value)} placeholder="e.g., 29.99" /></div>
                    <div style={styles.formGroup}><label style={styles.label}>Product Cost</label><input type="number" style={styles.input} value={aiCache.productInfo.cost} onChange={e => setProductInfo('cost', e.target.value)} placeholder="e.g., 7.50" /></div>
                    <div style={styles.formGroup}><label style={styles.label}>FBA Fee</label><input type="number" style={styles.input} value={aiCache.productInfo.fbaFee} onChange={e => setProductInfo('fbaFee', e.target.value)} placeholder="e.g., 6.50" /></div>
                    <div style={styles.formGroup}><label style={styles.label}>Referral Fee (%)</label><input type="number" style={styles.input} value={aiCache.productInfo.referralFeePercent} onChange={e => setProductInfo('referralFeePercent', e.target.value)} placeholder="e.g., 15" /></div>
                </div>

                <hr style={{border: 'none', borderTop: '1px solid var(--border-color)', margin: '10px 0'}}/>

                <div style={styles.toolCard}>
                    <div style={styles.toolHeader}>
                        <h3 style={styles.toolTitle}>Load Performance Data</h3>
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Date Range</label>
                        <div style={styles.dateInputContainer}>
                            <input type="date" style={styles.input} value={aiCache.dateRange.startDate} onChange={e => setDateRange('startDate', e.target.value)} />
                            <input type="date" style={styles.input} value={aiCache.dateRange.endDate} onChange={e => setDateRange('endDate', e.target.value)} />
                        </div>
                    </div>
                    <div style={{marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '15px'}}>
                        <ToolButton tool="st" onRun={handleLoadData} onView={handleViewData} loading={loading.st} data={aiCache.loadedData.searchTermData} error={error.st} name="Search Term Report" />
                        <ToolButton tool="stream" onRun={handleLoadData} onView={handleViewData} loading={loading.stream} data={aiCache.loadedData.streamData} error={error.stream} name="Stream Data" />
                        <ToolButton tool="sat" onRun={handleLoadData} onView={handleViewData} loading={loading.sat} data={aiCache.loadedData.salesTrafficData} error={error.sat} name="Sales & Traffic" />
                    </div>
                </div>
            </div>
            <div style={styles.rightPanel}>
                <div style={styles.chatWindow} ref={chatEndRef}>
                    {aiCache.chat.messages.length === 0 && <p style={{textAlign: 'center', color: '#888'}}>Load data and ask a question to start your conversation.</p>}
                    {aiCache.chat.messages.map(msg => (
                        <div key={msg.id} style={{...styles.message, ...(msg.sender === 'user' ? styles.userMessage : styles.aiMessage), display: 'flex', flexDirection: 'column'}}>
                             <div dangerouslySetInnerHTML={{ __html: marked(msg.text) }}></div>
                        </div>
                    ))}
                    {loading.chat && aiCache.chat.messages.length > 0 && aiCache.chat.messages[aiCache.chat.messages.length - 1].sender === 'user' && (
                        <div style={{...styles.message, ...styles.aiMessage}}><em style={{color: '#666'}}>AI is thinking...</em></div>
                    )}
                    {error.chat && <div style={{...styles.message, ...styles.aiMessage, backgroundColor: '#fdd', color: 'var(--danger-color)'}}>{error.chat}</div>}
                </div>
                <form style={styles.chatInputForm} onSubmit={handleStartConversation}>
                    <input style={styles.chatInput} value={currentQuestion} onChange={e => setCurrentQuestion(e.target.value)} placeholder="Ask a question about the loaded data..." disabled={loading.chat} />
                    <button type="submit" style={styles.sendButton} disabled={loading.chat || !currentQuestion.trim()}>Send</button>
                </form>
            </div>
        </div>
    );
}

const ToolButton = ({ tool, onRun, onView, loading, data, error, name }: { tool: 'st' | 'stream' | 'sat', onRun: (tool: 'st' | 'stream' | 'sat') => void, onView: (tool: 'st' | 'stream' | 'sat') => void, loading: boolean, data: any[] | null, error: string, name: string }) => (
    <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 500 }}>{name}</span>
            <button type="button" onClick={() => onRun(tool)} style={styles.toolButton} disabled={loading}>
                {loading ? 'Loading...' : (data ? 'Reload' : 'Load')}
            </button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        {data && (
            <button
                type="button"
                onClick={() => onView(tool)}
                style={{...styles.toolStatus, cursor: 'pointer', border: 'none', background: 'none', padding: 0, textAlign: 'left', color: 'var(--primary-color)'}}
                title="Click to view loaded data in a new tab"
            >
                ✅ Loaded {Array.isArray(data) ? `${data.length} records` : 'data'}.
            </button>
        )}
    </div>
);