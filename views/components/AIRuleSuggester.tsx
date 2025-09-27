// views/components/AIRuleSuggester.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';

// --- Type Definitions ---
type TraceStepType = 'thought' | 'action' | 'observation';
interface TraceStep {
    type: TraceStepType;
    content: string;
}
interface ChatMessage {
    type: 'user' | 'agent' | 'agent_trace' | 'rule' | 'error' | 'playbook';
    content: any; // string for user/agent, TraceStep[] for agent_trace, etc.
    id: number;
}
interface SuggestedRule {
    name: string;
    rule_type: string;
    ad_type?: string;
    config: any;
}
interface Playbook {
    playbook_title: string;
    phase_1_campaigns: string[];
    phase_1_keywords: string[];
    initial_bid: string;
    initial_automation_rule_name: string;
    initial_automation_rule_goal: string;
    phase_2_strategy: string;
}

// --- Styles ---
const spinnerKeyframes = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
const styles: { [key: string]: React.CSSProperties } = {
    container: { fontFamily: 'sans-serif' },
    toggleContainer: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', padding: '10px', backgroundColor: '#f0f2f2', borderRadius: '8px' },
    toggleLabel: { fontWeight: 600, color: '#333' },
    toggleSwitch: { position: 'relative', display: 'inline-block', width: '60px', height: '34px' },
    toggleInput: { opacity: 0, width: 0, height: 0 },
    toggleSlider: { position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#ccc', transition: '.4s', borderRadius: '34px' },
    toggleSliderBefore: { position: 'absolute', content: '""', height: '26px', width: '26px', left: '4px', bottom: '4px', backgroundColor: 'white', transition: '.4s', borderRadius: '50%' },
    contentGrid: { display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '30px', alignItems: 'start' },
    formCard: { backgroundColor: 'var(--card-background-color)', borderRadius: 'var(--border-radius)', boxShadow: 'var(--box-shadow)', padding: '25px', display: 'flex', flexDirection: 'column', gap: '20px' },
    formGroup: { display: 'flex', flexDirection: 'column', gap: '8px' },
    label: { fontWeight: 500, fontSize: '0.9rem' },
    input: { padding: '10px', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '1rem', width: '100%' },
    textarea: { padding: '10px', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '1rem', width: '100%', minHeight: '100px', resize: 'vertical' },
    button: { padding: '12px 20px', backgroundColor: 'var(--primary-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' },
    buttonDisabled: { backgroundColor: 'var(--primary-hover-color)', cursor: 'not-allowed' },
    resultsContainer: { display: 'flex', flexDirection: 'column', gap: '0', backgroundColor: '#f9f9f9', borderRadius: 'var(--border-radius)', boxShadow: 'var(--box-shadow)', height: 'calc(100% - 40px)', maxHeight: '70vh' },
    chatHistory: { flexGrow: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' },
    chatInputForm: { display: 'flex', borderTop: '1px solid var(--border-color)', padding: '15px', backgroundColor: 'white', borderBottomLeftRadius: 'var(--border-radius)', borderBottomRightRadius: 'var(--border-radius)' },
    chatInput: { flexGrow: 1, padding: '10px', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '1rem', marginRight: '10px' },
    resultCard: { backgroundColor: 'var(--card-background-color)', borderRadius: 'var(--border-radius)', padding: '20px', border: '1px solid #eee' },
    resultTitle: { fontSize: '1.2rem', fontWeight: 600, margin: '0 0 15px 0', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' },
    error: { color: 'var(--danger-color)', padding: '15px', backgroundColor: '#fdd', borderRadius: 'var(--border-radius)', border: '1px solid var(--danger-color)', margin: '20px' },
    loaderContainer: { display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '50px' },
    loader: { border: '4px solid #f3f3f3', borderTop: '4px solid var(--primary-color)', borderRadius: '50%', width: '40px', height: '40px', animation: 'spin 1s linear infinite' },
    placeholder: { textAlign: 'center', color: '#666', padding: '50px', backgroundColor: '#f8f9fa', borderRadius: 'var(--border-radius)', border: '2px dashed var(--border-color)' },
    radioGroup: { display: 'flex', gap: '15px', flexWrap: 'wrap' },
    infoBox: { backgroundColor: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 'var(--border-radius)', padding: '15px', fontSize: '0.9rem', color: '#0050b3', marginBottom: '20px' },
    messageBubble: { maxWidth: '85%', padding: '10px 15px', borderRadius: '18px', wordWrap: 'break-word' },
    agentBubble: { backgroundColor: 'white', border: '1px solid #ddd', alignSelf: 'flex-start' },
    userBubble: { backgroundColor: '#007185', color: 'white', alignSelf: 'flex-end' },
    agentTrace: { backgroundColor: '#f0f2f2', color: '#444', borderRadius: '8px', padding: '15px', fontFamily: 'monospace', fontSize: '0.85rem', whiteSpace: 'pre-wrap', lineHeight: '1.6' },
};

// --- Child Components ---
const AgentTrace: React.FC<{ steps: TraceStep[] }> = ({ steps }) => (
    <details style={{alignSelf: 'flex-start', width: '100%', maxWidth: '85%'}}>
        <summary style={{cursor: 'pointer', fontWeight: 500}}>View Agent Trace</summary>
        <div style={{...styles.agentTrace, marginTop: '10px'}}>
            {steps.map((step, index) => {
                const label = step.type.charAt(0).toUpperCase() + step.type.slice(1);
                return <div key={index}><strong>{label}:</strong> {step.content}</div>;
            })}
        </div>
    </details>
);

const PlaybookCard: React.FC<{ playbook: Playbook }> = ({ playbook }) => (
     <div style={{ ...styles.messageBubble, ...styles.agentBubble, width: '100%', maxWidth: '85%' }}>
        <h3 style={styles.resultTitle}>{playbook.playbook_title}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', whiteSpace: 'pre-wrap' }}>
            <div>
                <strong>Phase 1: Discovery & Data Harvesting (First 2 Weeks)</strong>
                <ul style={{ margin: '5px 0 0 20px', padding: 0, listStyleType: 'disc' }}>
                    <li><strong>Campaigns:</strong> {playbook.phase_1_campaigns.join(', ')}</li>
                    <li><strong>Keywords:</strong> {playbook.phase_1_keywords.join(', ')}</li>
                    <li><strong>Initial Bid:</strong> {playbook.initial_bid}</li>
                    <li><strong>Initial Automation:</strong> "{playbook.initial_automation_rule_name}" ({playbook.initial_automation_rule_goal})</li>
                </ul>
            </div>
            <div>
                <strong>Phase 2: Profitability Optimization (Ongoing)</strong>
                <p style={{ margin: '5px 0 0 0' }}>{playbook.phase_2_strategy}</p>
            </div>
        </div>
    </div>
);

const SuggestedRuleCard: React.FC<{ result: { rule: SuggestedRule; reasoning: string } }> = ({ result }) => (
    <div style={{ ...styles.messageBubble, ...styles.agentBubble, maxWidth: '85%' }}>
        <h3 style={styles.resultTitle}>Final Answer: Suggested Rule "{result.rule.name}"</h3>
        <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0 }}>{result.reasoning}</p>
        {/* We can add a "Create Rule" button here later */}
    </div>
);

// --- Main Suggester Component ---
export function AIRuleSuggester() {
    const [isNewProduct, setIsNewProduct] = useState(false);
    
    // Form state
    const [existingProductInputs, setExistingProductInputs] = useState({ asin: 'B0DD45VPSL', salePrice: '27', productCost: '7', fbaFee: '7', referralFeePercent: '15', ruleType: 'BID_ADJUSTMENT' });
    const [newProductInputs, setNewProductInputs] = useState({ description: '', competitors: '', usp: '', goal: '' });
    
    const [dateRange, setDateRange] = useState({ start: new Date(2025, 7, 28).toISOString().split('T')[0], end: new Date(2025, 8, 27).toISOString().split('T')[0] });

    // Chat state
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    const handleExistingInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setExistingProductInputs(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleNewInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setNewProductInputs(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const appendToHistory = (type: ChatMessage['type'], content: any) => {
        setChatHistory(prev => [...prev, { type, content, id: Date.now() + Math.random() }]);
    };
    
    const appendToTrace = (type: TraceStepType, content: string) => {
        setChatHistory(prev => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage && lastMessage.type === 'agent_trace') {
                const updatedTrace = [...lastMessage.content, { type, content }];
                return [...prev.slice(0, -1), { ...lastMessage, content: updatedTrace }];
            }
            return [...prev, { type: 'agent_trace', content: [{ type, content }], id: Date.now() }];
        });
    };

    const processStream = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (part.startsWith('data: ')) {
                    try {
                        const jsonData = JSON.parse(part.substring(6));
                        switch(jsonData.type) {
                            case 'conversationStart': setConversationId(jsonData.content.conversationId); break;
                            case 'agent': appendToHistory('agent', jsonData.content); break;
                            case 'thought':
                            case 'action':
                            case 'observation': appendToTrace(jsonData.type, jsonData.content); break;
                            case 'result': appendToHistory('rule', jsonData.content); break;
                            case 'error': throw new Error(jsonData.content);
                        }
                    } catch(e) { console.error("Stream parse error:", e, "Part:", part); }
                }
            }
            buffer = parts[parts.length - 1];
        }
    };

    const handleInitialSubmit = useCallback(async () => {
        setLoading(true);
        setChatHistory([]);
        setConversationId(null);

        const body = {
            isNewProduct,
            productData: isNewProduct ? newProductInputs : { asin: existingProductInputs.asin, salePrice: parseFloat(existingProductInputs.salePrice), productCost: parseFloat(existingProductInputs.productCost), fbaFee: parseFloat(existingProductInputs.fbaFee), referralFeePercent: parseFloat(existingProductInputs.referralFeePercent) },
            ruleType: isNewProduct ? null : existingProductInputs.ruleType,
            dateRange: isNewProduct ? null : dateRange
        };

        try {
            const response = await fetch('/api/ai/suggest-rule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'An unknown error occurred.' }));
                throw new Error(errorData.message || 'Failed to start suggestion.');
            }

            if (isNewProduct) {
                const result = await response.json();
                if (result.type === 'playbook' && result.content) {
                    appendToHistory('playbook', result.content);
                } else {
                    throw new Error("Received an unexpected response for the new product plan.");
                }
            } else {
                if (!response.body) throw new Error('Response body is missing for streaming.');
                const reader = response.body.getReader();
                await processStream(reader);
            }
        } catch (err) {
            appendToHistory('error', err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setLoading(false);
        }
    }, [isNewProduct, newProductInputs, existingProductInputs, dateRange]);

    const handleSendMessage = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim() || !conversationId || loading) return;

        appendToHistory('user', chatInput);
        const messageToSend = chatInput;
        setChatInput('');
        setLoading(true);
        
        try {
            const response = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId, message: messageToSend }),
            });

            if (!response.ok || !response.body) {
                const errorData = await response.json().catch(() => ({ message: 'Failed to send message.' }));
                throw new Error(errorData.message || 'An unknown error occurred.');
            }
            
            const reader = response.body.getReader();
            await processStream(reader);
        } catch (err) {
            appendToHistory('error', err instanceof Error ? err.message : 'Failed to get a response.');
        } finally {
            setLoading(false);
        }
    }, [conversationId, chatInput, loading]);

    const renderMessageContent = (message: ChatMessage) => {
        switch (message.type) {
            case 'user': return <div style={{ ...styles.messageBubble, ...styles.userBubble }}><p style={{margin:0}}>{message.content}</p></div>;
            case 'agent': return <div style={{ ...styles.messageBubble, ...styles.agentBubble }}><p style={{margin:0, whiteSpace: 'pre-wrap'}}>{message.content}</p></div>;
            case 'error': return <div style={styles.error}>{message.content}</div>;
            case 'agent_trace': return <AgentTrace steps={message.content} />;
            case 'rule': return <SuggestedRuleCard result={message.content} />;
            case 'playbook': return <PlaybookCard playbook={message.content} />;
            default: return null;
        }
    };

    return (
        <div style={styles.container}>
            <style>{spinnerKeyframes}</style>
            <div style={styles.toggleContainer}>
                <span style={styles.toggleLabel}>Sản phẩm có sẵn dữ liệu</span>
                <label style={styles.toggleSwitch}>
                    <input type="checkbox" style={styles.toggleInput} checked={isNewProduct} onChange={() => setIsNewProduct(p => !p)} />
                    <span style={{...styles.toggleSlider, backgroundColor: isNewProduct ? 'var(--primary-color)' : '#ccc'}}>
                        <span style={{...styles.toggleSliderBefore, transform: isNewProduct ? 'translateX(26px)' : 'translateX(0)'}} />
                    </span>
                </label>
                <span style={styles.toggleLabel}>Sản phẩm mới (không có dữ liệu)</span>
            </div>
            <div style={styles.contentGrid}>
                <div style={styles.formCard}>
                    {isNewProduct ? (
                        <>
                           <div style={styles.infoBox}><strong>Đề xuất Kế hoạch Khởi chạy:</strong> Agent AI sẽ phân tích thông tin sản phẩm của bạn để xây dựng một chiến lược khởi chạy PPC toàn diện, bao gồm cấu trúc chiến dịch, từ khóa và các quy tắc tự động hóa ban đầu.</div>
                            <div style={styles.formGroup}><label style={styles.label}>Mô tả sản phẩm</label><textarea style={styles.textarea} name="description" value={newProductInputs.description} onChange={handleNewInputChange} placeholder="Ví dụ: ghế tắm bằng gỗ tre, chống trượt..." required /></div>
                            <div style={styles.formGroup}><label style={styles.label}>Đối thủ cạnh tranh (ASIN)</label><input style={styles.input} name="competitors" value={newProductInputs.competitors} onChange={handleNewInputChange} placeholder="Ví dụ: B0..., B0..." /></div>
                            <div style={styles.formGroup}><label style={styles.label}>Điểm bán hàng độc nhất (USP)</label><textarea style={styles.textarea} name="usp" value={newProductInputs.usp} onChange={handleNewInputChange} placeholder="Ví dụ: làm từ 100% tre tự nhiên, chịu tải trọng cao..." required /></div>
                            <div style={styles.formGroup}><label style={styles.label}>Mục tiêu chiến dịch</label><input style={styles.input} name="goal" value={newProductInputs.goal} onChange={handleNewInputChange} placeholder="Ví dụ: Tối đa hóa hiển thị, Đạt lợi nhuận nhanh" required /></div>
                            <button onClick={handleInitialSubmit} style={loading ? { ...styles.button, ...styles.buttonDisabled } : styles.button} disabled={loading}>{loading ? 'Đang xây dựng...' : 'Lấy Kế hoạch Khởi chạy'}</button>
                        </>
                    ) : (
                        <>
                            <div style={styles.infoBox}><strong>Đề xuất Dựa trên Dữ liệu:</strong> Agent AI sẽ sử dụng các công cụ để tự động truy vấn và phân tích dữ liệu hiệu suất sản phẩm của bạn. Dựa trên phân tích đó, nó sẽ xây dựng một quy tắc tự động hóa phù hợp nhất.</div>
                            <div style={styles.formGroup}><label style={styles.label}>ASIN</label><input style={styles.input} name="asin" value={existingProductInputs.asin} onChange={handleExistingInputChange} placeholder="B0DD45VPSL" required /></div>
                            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px'}}>
                                <div style={styles.formGroup}><label style={styles.label}>Giá bán</label><input type="number" step="0.01" style={styles.input} name="salePrice" value={existingProductInputs.salePrice} onChange={handleExistingInputChange} required /></div>
                                <div style={styles.formGroup}><label style={styles.label}>Giá sản phẩm (Cost)</label><input type="number" step="0.01" style={styles.input} name="productCost" value={existingProductInputs.productCost} onChange={handleExistingInputChange} required /></div>
                                <div style={styles.formGroup}><label style={styles.label}>Phí FBA</label><input type="number" step="0.01" style={styles.input} name="fbaFee" value={existingProductInputs.fbaFee} onChange={handleExistingInputChange} required /></div>
                                <div style={styles.formGroup}><label style={styles.label}>Phí giới thiệu (%)</label><input type="number" step="0.01" style={styles.input} name="referralFeePercent" value={existingProductInputs.referralFeePercent} onChange={handleExistingInputChange} required /></div>
                            </div>
                            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px'}}>
                                <div style={styles.formGroup}><label style={styles.label}>Ngày bắt đầu</label><input type="date" style={styles.input} value={dateRange.start} onChange={e => setDateRange(p => ({...p, start: e.target.value}))} required /></div>
                                <div style={styles.formGroup}><label style={styles.label}>Ngày kết thúc</label><input type="date" style={styles.input} value={dateRange.end} onChange={e => setDateRange(p => ({...p, end: e.target.value}))} required /></div>
                            </div>
                            <div style={styles.formGroup}><label style={styles.label}>Loại Rule muốn đề xuất</label><div style={styles.radioGroup}><label><input type="radio" name="ruleType" value="BID_ADJUSTMENT" checked={existingProductInputs.ruleType === 'BID_ADJUSTMENT'} onChange={handleExistingInputChange}/> Điều chỉnh Bid</label><label><input type="radio" name="ruleType" value="SEARCH_TERM_AUTOMATION" checked={existingProductInputs.ruleType === 'SEARCH_TERM_AUTOMATION'} onChange={handleExistingInputChange}/> Quản lý Search Term</label><label><input type="radio" name="ruleType" value="BUDGET_ACCELERATION" checked={existingProductInputs.ruleType === 'BUDGET_ACCELERATION'} onChange={handleExistingInputChange}/> Tăng tốc Ngân sách</label></div></div>
                            <button onClick={handleInitialSubmit} style={loading ? { ...styles.button, ...styles.buttonDisabled } : styles.button} disabled={loading}>{loading ? 'Agent đang làm việc...' : 'Nhờ AI Phân tích'}</button>
                        </>
                    )}
                </div>
                <div style={styles.resultsContainer}>
                    <div style={styles.chatHistory}>
                        {chatHistory.length === 0 && !loading && <div style={styles.placeholder}><p>Kết quả phân tích và cuộc trò chuyện với Agent sẽ được hiển thị ở đây.</p></div>}
                        {chatHistory.map(msg => renderMessageContent(msg))}
                        {loading && chatHistory.length === 0 && <div style={styles.loaderContainer}><div style={styles.loader}></div></div>}
                        <div ref={chatEndRef} />
                    </div>
                    {conversationId && (
                        <form onSubmit={handleSendMessage} style={styles.chatInputForm}>
                            <input style={styles.chatInput} value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask a follow-up question..." disabled={loading} />
                            <button type="submit" style={loading ? { ...styles.button, ...styles.buttonDisabled } : styles.button} disabled={loading}>{loading ? '...' : 'Send'}</button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}