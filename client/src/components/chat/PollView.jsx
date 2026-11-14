// Poll rendering + voting (polls live embedded in the message). Percentages
// are derived from the persisted votes on every render, and the server
// broadcasts message_updated on each vote so open clients stay live.
export default function PollView({ message, myId, onVote, onClosePoll }) {
  const poll = message.poll;
  if (!poll) return null;
  const totalVotes = poll.options.reduce((sum, o) => sum + (o.votes || []).length, 0);
  const mine = poll.options
    .filter((o) => (o.votes || []).some((v) => v.toString() === myId.toString()))
    .map((o) => o._id);
  const iAmCreator = (typeof message.senderId === 'object' ? message.senderId._id : message.senderId) === myId;

  function clickOption(option) {
    if (poll.closed) return;
    let next;
    if (poll.allowMultiple) {
      next = mine.includes(option._id)
        ? mine.filter((id) => id !== option._id)
        : [...mine, option._id];
    } else {
      next = mine.includes(option._id) ? [] : [option._id];
    }
    onVote(message, next);
  }

  return (
    <div className="poll">
      <p className="poll-question">📊 {poll.question}</p>
      <div className="poll-options">
        {poll.options.map((option) => {
          const votes = (option.votes || []).length;
          const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
          const selected = mine.includes(option._id);
          return (
            <button
              key={option._id}
              className={`poll-option ${selected ? 'selected' : ''}`}
              onClick={() => clickOption(option)}
              disabled={poll.closed}
            >
              <span className="poll-option-bar" style={{ width: `${pct}%` }} />
              <span className="poll-option-text">
                {selected ? (poll.allowMultiple ? '☑' : '●') : poll.allowMultiple ? '☐' : '○'}{' '}
                {option.text}
              </span>
              <span className="poll-option-pct">{pct}%</span>
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        <span>
          {totalVotes} vote{totalVotes === 1 ? '' : 's'}
          {poll.allowMultiple ? ' · multiple choice' : ''}
          {poll.closed ? ' · closed' : ''}
        </span>
        {iAmCreator && !poll.closed && (
          <button className="mini-btn" onClick={() => onClosePoll(message)}>
            Close poll
          </button>
        )}
      </div>
    </div>
  );
}
