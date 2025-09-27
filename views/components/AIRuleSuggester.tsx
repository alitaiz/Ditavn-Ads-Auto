// views/components/AIRuleSuggester.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { marked } from 'marked';

// --- Type Definitions ---
interface ChatMessage {
    type: 'user' | 'agent' | 'error';
    content: string;
    // Fix: Allow id to be string or number to accommodate conversationId (string) and generated IDs (number)
    id: number | string;
}

// --- Styles ---
const spinnerKeyframes = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
const styles: { [key: string]: React.CSSProperties } = {
    container: { fontFamily: 'sans-serif' },
    contentGrid: { display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '30px', alignItems: 'start' },
    formCard: { backgroundColor: 'var(--card-background-color)', borderRadius: 'var(--border-radius)', boxShadow: 'var(--box-shadow)', padding: '25px', display: 'flex', flexDirection: 'column', gap: '20px' },
    formGroup: { display: 'flex', flexDirection: 'column', gap: '8px' },
    label: { fontWeight: 600, fontSize: '1rem', color: '#333' },
    input: { padding: '10px', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '1rem', width: '100%' },
    textarea: { padding: '10px', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '1rem', width: '100%', minHeight: '250px', resize: 'vertical', fontFamily: 'monospace' },
    button: { padding: '12px 20px', backgroundColor: 'var(--primary-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' },
    buttonDisabled: { backgroundColor: 'var(--primary-hover-color)', cursor: 'not-allowed' },
    resultsContainer: { display: 'flex', flexDirection: 'column', gap: '0', backgroundColor: '#f9f9f9', borderRadius: 'var(--border-radius)', boxShadow: 'var(--box-shadow)', height: 'calc(100% - 40px)', maxHeight: '70vh' },
    chatHistory: { flexGrow: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' },
    chatInputForm: { display: 'flex', borderTop: '1px solid var(--border-color)', padding: '15px', backgroundColor: 'white', borderBottomLeftRadius: 'var(--border-radius)', borderBottomRightRadius: 'var(--border-radius)' },
    chatInput: { flexGrow: 1, padding: '10px', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '1rem', marginRight: '10px' },
    error: { color: 'var(--danger-color)', padding: '15px', backgroundColor: '#fdd', borderRadius: 'var(--border-radius)', border: '1px solid var(--danger-color)', margin: '20px', whiteSpace: 'pre-wrap' },
    loader: { border: '4px solid #f3f3f3', borderTop: '4px solid var(--primary-color)', borderRadius: '50%', width: '24px', height: '24px', animation: 'spin 1s linear infinite' },
    placeholder: { textAlign: 'center', color: '#666', padding: '50px', backgroundColor: '#f8f9fa', borderRadius: 'var(--border-radius)', border: '2px dashed var(--border-color)' },
    infoBox: { backgroundColor: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 'var(--border-radius)', padding: '15px', fontSize: '0.9rem', color: '#0050b3' },
    messageBubble: { maxWidth: '85%', padding: '10px 15px', borderRadius: '18px', wordWrap: 'break-word', lineHeight: 1.5 },
    agentBubble: { backgroundColor: 'white', border: '1px solid #ddd', alignSelf: 'flex-start' },
    userBubble: { backgroundColor: 'var(--primary-color)', color: 'white', alignSelf: 'flex-end' },
};

export function AIRuleSuggester() {
    // Form state for context
    const [contextData, setContextData] = useState('');
    const [initialQuestion, setInitialQuestion] = useState('Based on the data, suggest a bid adjustment rule to improve profitability.');

    // Chat state
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);
    
    // Parses and sanitizes markdown content for safe display
    const renderMarkdown = (content: string) => {
        const rawMarkup = marked.parse(content, { gfm: true, breaks: true });
        // Basic sanitization could be improved with a library like DOMPurify if needed
        return { __html: rawMarkup };
    };

    const appendToHistory = (type: ChatMessage['type'], content: string, isStreaming = false) => {
        setChatHistory(prev => {
            const lastMessage = prev[prev.length - 1];
            if (isStreaming && lastMessage && lastMessage.type === type && lastMessage.id === conversationId) {
                // Append content to the last streaming message
                const updatedContent = lastMessage.content + content;
                return [...prev.slice(0, -1), { ...lastMessage, content: updatedContent }];
            }
            // Add a new message
            const newId = type === 'agent' && isStreaming ? conversationId : Date.now() + Math.random();
            return [...prev, { type, content, id: newId! }];
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
                            case 'conversationStart':
                                setConversationId(jsonData.content.conversationId);
                                break;
                            case 'text_chunk':
                                appendToHistory('agent', jsonData.content, true);
                                break;
                            case 'error':
                                throw new Error(jsonData.content);
                        }
                    } catch(e) { console.error("Stream parse error:", e, "Part:", part); }
                }
            }
            buffer = parts[parts.length - 1];
        }
    };
    
    const handleInitialSubmit = useCallback(async () => {
        setLoading(true);
        setConversationId(null);
        setChatHistory([{ type: 'user', content: initialQuestion, id: Date.now() }]);
        appendToHistory('agent', '', true); // Start with an empty streaming bubble

        const body = { contextData, initialQuestion };

        try {
            const response = await fetch('/api/ai/start-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok || !response.body) {
                const errorData = await response.json().catch(() => ({ message: 'An unknown server error occurred.' }));
                throw new Error(errorData.message || `HTTP Error: ${response.status}`);
            }
            
            await processStream(response.body.getReader());
        } catch (err) {
            appendToHistory('error', err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setLoading(false);
        }
    }, [contextData, initialQuestion]);

    const handleSendMessage = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim() || !conversationId || loading) return;

        appendToHistory('user', chatInput);
        const messageToSend = chatInput;
        setChatInput('');
        setLoading(true);
        appendToHistory('agent', '', true); // Start with an empty streaming bubble
        
        try {
            const response = await fetch('/api/ai/send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId, message: messageToSend }),
            });

            if (!response.ok || !response.body) {
                const errorData = await response.json().catch(() => ({ message: 'Failed to send message.' }));
                throw new Error(errorData.message || 'An unknown server error occurred.');
            }
            
            await processStream(response.body.getReader());
        } catch (err) {
            appendToHistory('error', err instanceof Error ? err.message : 'Failed to get a response.');
        } finally {
            setLoading(false);
        }
    }, [conversationId, chatInput, loading]);

    const renderMessageContent = (message: ChatMessage) => {
        switch (message.type) {
            case 'user':
                return <div style={{ ...styles.messageBubble, ...styles.userBubble }}><p style={{margin:0}}>{message.content}</p></div>;
            case 'agent':
                return (
                    <div style={{ ...styles.messageBubble, ...styles.agentBubble }}>
                        <div dangerouslySetInnerHTML={renderMarkdown(message.content)} />
                        {loading && message.id === conversationId && <span style={{ ...styles.loader, width: '16px', height: '16px', display: 'inline-block', marginLeft: '8px', verticalAlign: 'middle' }}></span>}
                    </div>
                );
            case 'error':
                return <div style={styles.error}>{message.content}</div>;
            default: return null;
        }
    };

    return (
        <div style={styles.container}>
            <style>{spinnerKeyframes}</style>
            <div style={styles.contentGrid}>
                <div style={styles.formCard}>
                    <div style={styles.infoBox}>
                        <strong>AI Co-Pilot:</strong> Trò chuyện trực tiếp với AI để phân tích dữ liệu và nhận các đề xuất chiến lược PPC.
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Context Data (Optional)</label>
                        <textarea
                            style={styles.textarea}
                            value={contextData}
                            onChange={e => setContextData(e.target.value)}
                            placeholder="Paste any relevant data here, such as exported CSV data, performance metrics, product details, or competitor information..."
                        />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Initial Question</label>
                        <input
                            style={styles.input}
                            value={initialQuestion}
                            onChange={e => setInitialQuestion(e.target.value)}
                            required
                        />
                    </div>
                    <button onClick={handleInitialSubmit} style={loading ? { ...styles.button, ...styles.buttonDisabled } : styles.button} disabled={loading}>
                        {loading ? 'AI is thinking...' : 'Start Conversation'}
                    </button>
                </div>
                <div style={styles.resultsContainer}>
                    <div style={styles.chatHistory}>
                        {chatHistory.length === 0 && !loading && (
                            <div style={styles.placeholder}>
                                <p>Your conversation with the AI Co-Pilot will appear here.</p>
                            </div>
                        )}
                        {chatHistory.map(msg => renderMessageContent(msg))}
                        <div ref={chatEndRef} />
                    </div>
                    {conversationId && (
                        <form onSubmit={handleSendMessage} style={styles.chatInputForm}>
                            <input style={styles.chatInput} value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask a follow-up question..." disabled={loading} />
                            <button type="submit" style={loading ? { ...styles.button, ...styles.buttonDisabled } : styles.button} disabled={loading}>
                                {loading ? <div style={{ ...styles.loader, width: '16px', height: '16px' }}></div> : 'Send'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
