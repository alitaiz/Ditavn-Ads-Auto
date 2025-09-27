// views/AICopilotView.tsx
import React, { useState, useRef, useEffect } from 'react';
import { marked } from 'marked';

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

interface ChatMessage {
    id: number;
    sender: 'user' | 'ai';
    text: string;
}

export function AICopilotView() {
    // Input states
    const [asin, setAsin] = useState('');
    const [salePrice, setSalePrice] = useState('');
    const [cost, setCost] = useState('');
    const [fbaFee, setFbaFee] = useState('');
    const [referralFeePercent, setReferralFeePercent] = useState('15');
    const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 8); return d.toISOString().split('T')[0]; });
    const [endDate, setEndDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; });

    // Loaded data states
    const [searchTermData, setSearchTermData] = useState(null);
    const [streamData, setStreamData] = useState(null);
    const [salesTrafficData, setSalesTrafficData] = useState(null);

    // Loading & error states for tools
    const [loading, setLoading] = useState({ st: false, stream: false, sat: false, chat: false });
    const [error, setError] = useState({ st: '', stream: '', sat: '', chat: '' });

    // Chat states
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [currentQuestion, setCurrentQuestion] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleLoadData = async (tool: 'st' | 'stream' | 'sat') => {
        setLoading(prev => ({ ...prev, [tool]: true }));
        setError(prev => ({ ...prev, [tool]: '' }));
        
        let endpoint = '';
        let setDataFunc: React.Dispatch<React.SetStateAction<any>>;

        switch (tool) {
            case 'st': 
                endpoint = '/api/ai/tool/search-term';
                setDataFunc = setSearchTermData;
                break;
            case 'stream':
                endpoint = '/api/ai/tool/stream';
                setDataFunc = setStreamData;
                break;
            case 'sat':
                endpoint = '/api/ai/tool/sales-traffic';
                setDataFunc = setSalesTrafficData;
                break;
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ asin, startDate, endDate }),
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

    const handleStartConversation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentQuestion.trim()) return;

        const newUserMessage: ChatMessage = { id: Date.now(), sender: 'user', text: currentQuestion };
        setMessages(prev => [...prev, newUserMessage]);
        
        setLoading(prev => ({...prev, chat: true}));
        setError(prev => ({...prev, chat: ''}));

        try {
            const payload = {
                question: currentQuestion,
                conversationId: conversationId,
                context: {
                    productInfo: { asin, salePrice, cost, fbaFee, referralFeePercent },
                    performanceData: { searchTermData, streamData, salesTrafficData }
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
            let newConversationId: string | null = null;
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
                            newConversationId = parsed.conversationId;
                            setConversationId(newConversationId);
                            setMessages(prev => [...prev, { id: currentAiMessageId, sender: 'ai', text: '' }]);
                            isFirstChunk = false;
                        }

                        if (parsed.content) {
                            aiResponseText += parsed.content;
                            setMessages(prev => prev.map(msg => 
                                msg.id === currentAiMessageId ? { ...msg, text: aiResponseText } : msg
                            ));
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
             setCurrentQuestion('');
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.leftPanel}>
                <h2>AI Co-Pilot Control Panel</h2>
                <div style={styles.formGroup}>
                    <label style={styles.label}>ASIN</label>
                    <input style={styles.input} value={asin} onChange={e => setAsin(e.target.value)} placeholder="e.g., B0DD45VPSL" />
                </div>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px'}}>
                    <div style={styles.formGroup}><label style={styles.label}>Sale Price</label><input type="number" style={styles.input} value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="e.g., 29.99" /></div>
                    <div style={styles.formGroup}><label style={styles.label}>Product Cost</label><input type="number" style={styles.input} value={cost} onChange={e => setCost(e.target.value)} placeholder="e.g., 7.50" /></div>
                    <div style={styles.formGroup}><label style={styles.label}>FBA Fee</label><input type="number" style={styles.input} value={fbaFee} onChange={e => setFbaFee(e.target.value)} placeholder="e.g., 6.50" /></div>
                    <div style={styles.formGroup}><label style={styles.label}>Referral Fee (%)</label><input type="number" style={styles.input} value={referralFeePercent} onChange={e => setReferralFeePercent(e.target.value)} placeholder="e.g., 15" /></div>
                </div>

                <hr style={{border: 'none', borderTop: '1px solid var(--border-color)', margin: '10px 0'}}/>

                <div style={styles.toolCard}>
                    <div style={styles.toolHeader}>
                        <h3 style={styles.toolTitle}>Load Performance Data</h3>
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Date Range</label>
                        <div style={styles.dateInputContainer}>
                            <input type="date" style={styles.input} value={startDate} onChange={e => setStartDate(e.target.value)} />
                            <input type="date" style={styles.input} value={endDate} onChange={e => setEndDate(e.target.value)} />
                        </div>
                    </div>
                    <div style={{marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '15px'}}>
                        <ToolButton tool="st" onRun={handleLoadData} loading={loading.st} data={searchTermData} error={error.st} name="Search Term Report" />
                        <ToolButton tool="stream" onRun={handleLoadData} loading={loading.stream} data={streamData} error={error.stream} name="Stream Data" />
                        <ToolButton tool="sat" onRun={handleLoadData} loading={loading.sat} data={salesTrafficData} error={error.sat} name="Sales & Traffic" />
                    </div>
                </div>
            </div>
            <div style={styles.rightPanel}>
                <div style={styles.chatWindow} ref={chatEndRef}>
                    {messages.length === 0 && <p style={{textAlign: 'center', color: '#888'}}>Your conversation with the AI Co-Pilot will appear here.</p>}
                    {messages.map(msg => (
                        <div key={msg.id} style={{...styles.message, ...(msg.sender === 'user' ? styles.userMessage : styles.aiMessage), display: 'flex', flexDirection: 'column'}}>
                             <div dangerouslySetInnerHTML={{ __html: marked(msg.text) }}></div>
                        </div>
                    ))}
                    {loading.chat && <div style={{...styles.message, ...styles.aiMessage}}><em style={{color: '#666'}}>AI is thinking...</em></div>}
                    {error.chat && <div style={{...styles.message, ...styles.aiMessage, backgroundColor: '#fdd', color: 'var(--danger-color)'}}>{error.chat}</div>}
                </div>
                <form style={styles.chatInputForm} onSubmit={handleStartConversation}>
                    <input style={styles.chatInput} value={currentQuestion} onChange={e => setCurrentQuestion(e.target.value)} placeholder="Ask a follow-up question..." disabled={loading.chat} />
                    <button type="submit" style={styles.sendButton} disabled={loading.chat || messages.length === 0}>Send</button>
                </form>
            </div>
        </div>
    );
}

const ToolButton = ({ tool, onRun, loading, data, error, name }: { tool: 'st' | 'stream' | 'sat', onRun: (tool: 'st' | 'stream' | 'sat') => void, loading: boolean, data: any, error: string, name: string }) => (
    <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 500 }}>{name}</span>
            <button type="button" onClick={() => onRun(tool)} style={styles.toolButton} disabled={loading}>
                {loading ? 'Loading...' : (data ? 'Reload' : 'Load')}
            </button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        {data && <p style={styles.toolStatus}>✅ Loaded {Array.isArray(data) ? `${data.length} records` : 'data'}.</p>}
    </div>
);