// views/components/AIRuleSuggester.tsx
import React, { useState } from 'react';

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    backgroundColor: 'var(--card-background-color)',
    padding: '30px',
    borderRadius: 'var(--border-radius)',
    boxShadow: 'var(--box-shadow)',
    maxWidth: '800px',
    margin: '20px auto',
  },
  title: {
    fontSize: '1.75rem',
    margin: '0 0 10px 0',
  },
  p: {
    margin: '0 0 20px 0',
    color: '#555',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  label: {
    fontWeight: 500,
    fontSize: '0.9rem',
  },
  input: {
    padding: '10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '1rem',
    width: '100%',
  },
  select: {
    padding: '10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '1rem',
    width: '100%',
  },
  button: {
    padding: '12px 20px',
    backgroundColor: 'var(--primary-color)',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
    alignSelf: 'flex-start',
  },
  suggestionBox: {
    marginTop: '30px',
    padding: '20px',
    border: '1px dashed var(--border-color)',
    borderRadius: 'var(--border-radius)',
    backgroundColor: '#f8f9fa',
  },
  suggestionTitle: {
    fontSize: '1.2rem',
    fontWeight: 600,
    margin: '0 0 15px 0',
  },
  pre: {
    backgroundColor: '#e9ecef',
    padding: '15px',
    borderRadius: '4px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: '400px',
    overflowY: 'auto',
  },
  error: {
    color: 'var(--danger-color)',
    marginTop: '15px',
  }
};

export function AIRuleSuggester() {
  const [goal, setGoal] = useState('');
  const [ruleType, setRuleType] = useState<'BID_ADJUSTMENT' | 'SEARCH_TERM_AUTOMATION'>('BID_ADJUSTMENT');
  const [suggestion, setSuggestion] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) {
      setError('Please describe your goal.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestion(null);

    try {
      const response = await fetch('/api/ai/suggest-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, ruleType }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to get suggestion.');
      }

      const data = await response.json();
      setSuggestion(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>AI Rule Assistant</h2>
      <p style={styles.p}>
        Describe your advertising goal in plain English, and the AI will suggest a rule to help you achieve it.
        For example: "Lower my ACOS for keywords that spend a lot but don't convert" or "Negate search terms that are wasting money".
      </p>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div>
          <label htmlFor="rule-type-select" style={styles.label}>What kind of rule do you need?</label>
          <select
            id="rule-type-select"
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value as any)}
            style={styles.select}
            disabled={loading}
          >
            <option value="BID_ADJUSTMENT">Bid Adjustment Rule</option>
            <option value="SEARCH_TERM_AUTOMATION">Search Term Negation Rule</option>
          </select>
        </div>
        <div>
          <label htmlFor="goal-input" style={styles.label}>Describe your goal:</label>
          <textarea
            id="goal-input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            style={{ ...styles.input, minHeight: '80px', resize: 'vertical' }}
            placeholder="e.g., Lower bids on keywords with high ACOS and low orders..."
            disabled={loading}
          />
        </div>
        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? 'Getting Suggestion...' : 'Get AI Suggestion'}
        </button>
      </form>
      {error && <p style={styles.error}>{error}</p>}
      {suggestion && (
        <div style={styles.suggestionBox}>
          <h3 style={styles.suggestionTitle}>Suggested Rule: {suggestion.name}</h3>
          <p>Here is a JSON configuration based on your goal. You can use this as a starting point when creating a new rule.</p>
          <pre style={styles.pre}>
            <code>{JSON.stringify(suggestion, null, 2)}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
