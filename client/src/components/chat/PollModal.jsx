import { useState } from 'react';

// Create-a-poll form: question + 2–10 options + single/multiple choice.
export default function PollModal({ onClose, onCreate }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function setOption(i, value) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  }

  async function submit() {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) return setError('Write a question');
    if (opts.length < 2) return setError('Add at least two options');
    setBusy(true);
    setError('');
    try {
      await onCreate({
        question: question.trim(),
        options: opts,
        allowMultiple,
      });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create poll</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <input
          className="text-input"
          placeholder="Ask a question…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
          autoFocus
        />
        <div className="poll-editor">
          {options.map((o, i) => (
            <div className="poll-editor-row" key={i}>
              <input
                className="text-input"
                placeholder={`Option ${i + 1}`}
                value={o}
                maxLength={200}
                onChange={(e) => setOption(i, e.target.value)}
              />
              {options.length > 2 && (
                <button
                  className="icon-btn"
                  onClick={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button className="btn small ghost" onClick={() => setOptions((prev) => [...prev, ''])}>
              + Add option
            </button>
          )}
        </div>
        <label className="switch-row">
          <span>Allow multiple answers</span>
          <input
            type="checkbox"
            checked={allowMultiple}
            onChange={(e) => setAllowMultiple(e.target.checked)}
          />
        </label>
        <button className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Creating…' : 'Create poll'}
        </button>
      </div>
    </div>
  );
}
