import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, uploadFile, API_URL, getToken } from '../services/api';
import Avatar from '../components/Avatar';

// Documents & tasks (module 32): one view for shared folders — files,
// notes and task lists — with sharing enforced by the server on every
// request. Uploads go through the existing uploads pipeline first, then
// the returned URL is registered in the folder; downloads always go
// through the access-checked /api/docs/files/:id/download endpoint.

const TASK_STATUSES = ['todo', 'in-progress', 'done'];

export default function Documents() {
  const { user: me } = useAuth();
  const [folders, setFolders] = useState([]);
  const [openFolder, setOpenFolder] = useState(null); // folder detail payload
  const [error, setError] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [noteDraft, setNoteDraft] = useState({ title: '', content: '' });
  const [editingNote, setEditingNote] = useState(null);
  const [taskDraft, setTaskDraft] = useState({}); // listId -> {title, assigneeId, dueDate}
  const [newListTitle, setNewListTitle] = useState('');
  const [shareTarget, setShareTarget] = useState(null); // {kind: 'folder'|'list', item}
  const [shareQuery, setShareQuery] = useState('');
  const [shareResults, setShareResults] = useState([]);
  const [myConversations, setMyConversations] = useState([]);
  const fileInputRef = useRef(null);
  const pendingListRef = useRef(null);

  const loadFolders = useCallback(async () => {
    try {
      const data = await api('/api/docs/folders');
      setFolders(data.folders || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const openFolderById = useCallback(async (id) => {
    try {
      const data = await api(`/api/docs/folders/${id}`);
      setOpenFolder(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    document.title = 'ConnectX · Documents';
    loadFolders();
    api('/api/conversations')
      .then((d) => setMyConversations(d.conversations || []))
      .catch(() => {});
  }, [loadFolders]);

  async function createFolder(e) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await api('/api/docs/folders', { method: 'POST', body: { name: newFolderName.trim() } });
      setNewFolderName('');
      await loadFolders();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteFolder(folder) {
    if (!window.confirm(`Delete folder “${folder.name}” and everything in it?`)) return;
    try {
      await api(`/api/docs/folders/${folder._id}`, { method: 'DELETE' });
      if (openFolder?.folder._id === folder._id) setOpenFolder(null);
      await loadFolders();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onPickFile(e, folderId) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const uploaded = await uploadFile(file);
      await api(`/api/docs/folders/${folderId}/files`, {
        method: 'POST',
        body: { name: file.name, url: uploaded.url, size: file.size, mimeType: file.type },
      });
      await openFolderById(folderId);
    } catch (err) {
      setError(err.message);
    }
  }

  function downloadUrl(fileId) {
    return `${API_URL}/api/docs/files/${fileId}/download`;
  }

  async function downloadFile(file) {
    // The endpoint enforces access server-side; fetch with the token and
    // save the blob so the Authorization header is honoured.
    try {
      const res = await fetch(downloadUrl(file._id), {
        headers: { Authorization: `Bearer ${getToken()}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Download was refused');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveNote(e, folderId) {
    e.preventDefault();
    try {
      if (editingNote) {
        await api(`/api/docs/notes/${editingNote._id}`, {
          method: 'PATCH',
          body: { title: noteDraft.title, content: noteDraft.content },
        });
      } else {
        await api(`/api/docs/folders/${folderId}/notes`, {
          method: 'POST',
          body: { title: noteDraft.title, content: noteDraft.content },
        });
      }
      setNoteDraft({ title: '', content: '' });
      setEditingNote(null);
      await openFolderById(folderId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createTaskList(folderId) {
    if (!newListTitle.trim()) return;
    try {
      await api('/api/docs/task-lists', {
        method: 'POST',
        body: { title: newListTitle.trim(), folderId: folderId || null },
      });
      setNewListTitle('');
      if (folderId) await openFolderById(folderId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function addTask(listId, folderId) {
    const draft = taskDraft[listId] || {};
    if (!draft.title?.trim()) return;
    try {
      await api(`/api/docs/task-lists/${listId}/tasks`, {
        method: 'POST',
        body: {
          title: draft.title.trim(),
          assigneeId: draft.assigneeId || null,
          dueDate: draft.dueDate ? new Date(draft.dueDate).toISOString() : null,
        },
      });
      setTaskDraft({ ...taskDraft, [listId]: { title: '', assigneeId: '', dueDate: '' } });
      if (folderId) await openFolderById(folderId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function setTaskStatus(task, status, folderId) {
    try {
      await api(`/api/docs/tasks/${task._id}`, { method: 'PATCH', body: { status } });
      if (folderId) await openFolderById(folderId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function searchShareUsers(q) {
    setShareQuery(q);
    if (q.trim().length < 1) {
      setShareResults([]);
      return;
    }
    try {
      const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
      setShareResults(data.users || []);
    } catch (err) {
      /* best-effort */
    }
  }

  async function applyShare(body) {
    if (!shareTarget) return;
    const base = shareTarget.kind === 'folder' ? '/api/docs/folders' : '/api/docs/task-lists';
    try {
      await api(`${base}/${shareTarget.item._id}/share`, { method: 'POST', body });
      setShareTarget(null);
      setShareQuery('');
      setShareResults([]);
      await loadFolders();
      if (openFolder) await openFolderById(openFolder.folder._id);
    } catch (err) {
      setError(err.message);
    }
  }

  const folderDetail = openFolder?.folder;

  return (
    <div className="dash-shell">
      <header className="dash-header">
        <div className="brand">
          <span className="brand-mark">CX</span>
          <span className="brand-text"><span className="brand-name">ConnectX</span><span className="brand-sub">by Developer Mohammad Ahmad Khan</span></span>
        </div>
        <nav className="dash-nav">
          <Link className="btn small ghost" to="/home">🏠 Home</Link>
          <Link className="btn small ghost" to="/">💬 Chats</Link>
          <Link className="btn small ghost" to="/calendar">📅 Calendar</Link>
          <Link className="btn small ghost" to="/profile">Profile</Link>
        </nav>
      </header>

      <h1 className="dash-greeting">Documents &amp; tasks</h1>
      {error && <p className="form-error">{error}</p>}

      {!openFolder && (
        <>
          <form className="docs-newfolder" onSubmit={createFolder}>
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New folder name…"
              maxLength={120}
            />
            <button className="btn primary" type="submit">Create folder</button>
          </form>
          <div className="dash-grid">
            {folders.length === 0 && <p className="empty-note">No folders yet. Create one to share files, notes and tasks.</p>}
            {folders.map((folder) => (
              <div key={folder._id} className="dash-card doc-folder-card">
                <div className="dash-card-head">
                  <h3>📁 {folder.name}</h3>
                  <span className="cal-status">{folder.access === 'owner' ? 'Owner' : 'Shared with me'}</span>
                </div>
                <div className="info-sub">
                  by {typeof folder.owner === 'object' ? folder.owner.username : 'me'}
                  {(folder.sharedWith || []).length > 0 && ` · shared with ${folder.sharedWith.length} people`}
                </div>
                <div className="doc-card-actions">
                  <button className="btn small primary" onClick={() => openFolderById(folder._id)}>Open</button>
                  {folder.access === 'owner' && (
                    <>
                      <button className="btn small ghost" onClick={() => setShareTarget({ kind: 'folder', item: folder })}>Share</button>
                      <button className="btn small ghost danger-text" onClick={() => deleteFolder(folder)}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {openFolder && folderDetail && (
        <div className="docs-detail">
          <div className="docs-detail-head">
            <button className="btn small ghost" onClick={() => { setOpenFolder(null); loadFolders(); }}>← All folders</button>
            <h2>📁 {folderDetail.name}</h2>
            {folderDetail.access === 'owner' && (
              <button className="btn small ghost" onClick={() => setShareTarget({ kind: 'folder', item: folderDetail })}>Share</button>
            )}
          </div>

          <div className="dash-card">
            <div className="dash-card-head">
              <h3>Files</h3>
              <button className="mini-btn" onClick={() => { pendingListRef.current = folderDetail._id; fileInputRef.current?.click(); }}>
                ⬆ Upload file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={(e) => onPickFile(e, pendingListRef.current)}
              />
            </div>
            {(openFolder.files || []).length === 0 && <p className="empty-note">No files yet.</p>}
            {(openFolder.files || []).map((file) => (
              <div key={file._id} className="doc-row">
                <span>📄 {file.name}</span>
                <span className="info-sub">{file.size ? `${Math.max(1, Math.round(file.size / 1024))} KB` : ''}</span>
                <button className="mini-btn" onClick={() => downloadFile(file)}>Download</button>
              </div>
            ))}
          </div>

          <div className="dash-card">
            <div className="dash-card-head"><h3>Notes</h3></div>
            {(openFolder.notes || []).map((note) => (
              <div key={note._id} className="doc-note">
                <div className="doc-note-head">
                  <strong>{note.title}</strong>
                  <button
                    className="mini-btn"
                    onClick={() => { setEditingNote(note); setNoteDraft({ title: note.title, content: note.content }); }}
                  >
                    Edit
                  </button>
                </div>
                <p className="doc-note-body">{note.content}</p>
              </div>
            ))}
            <form className="doc-note-form" onSubmit={(e) => saveNote(e, folderDetail._id)}>
              <input
                value={noteDraft.title}
                onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })}
                placeholder="Note title"
                maxLength={200}
                required
              />
              <textarea
                value={noteDraft.content}
                onChange={(e) => setNoteDraft({ ...noteDraft, content: e.target.value })}
                placeholder="Write a shared note…"
                rows={3}
                maxLength={20000}
              />
              <button className="btn small primary" type="submit">{editingNote ? 'Save note' : 'Add note'}</button>
              {editingNote && (
                <button className="btn small ghost" type="button" onClick={() => { setEditingNote(null); setNoteDraft({ title: '', content: '' }); }}>
                  Cancel edit
                </button>
              )}
            </form>
          </div>

          <div className="dash-card">
            <div className="dash-card-head"><h3>Task lists</h3></div>
            {(openFolder.taskLists || []).map((list) => (
              <div key={list._id} className="doc-tasklist">
                <div className="doc-note-head">
                  <strong>✅ {list.title}</strong>
                  {list.owner === me._id && (
                    <button className="mini-btn" onClick={() => setShareTarget({ kind: 'list', item: list })}>Share list</button>
                  )}
                </div>
                {(list.tasks || []).map((task) => (
                  <div key={task._id} className="doc-row">
                    <span className={task.status === 'done' ? 'task-done' : ''}>{task.title}</span>
                    {task.assignee && typeof task.assignee === 'object' && (
                      <span className="cal-attendee">
                        <Avatar name={task.assignee.username} src={task.assignee.profilePicture} size={16} /> {task.assignee.username}
                      </span>
                    )}
                    {task.dueDate && <span className="info-sub">due {new Date(task.dueDate).toLocaleDateString()}</span>}
                    <select value={task.status} onChange={(e) => setTaskStatus(task, e.target.value, folderDetail._id)}>
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                ))}
                <div className="doc-task-add">
                  <input
                    value={(taskDraft[list._id] || {}).title || ''}
                    onChange={(e) => setTaskDraft({ ...taskDraft, [list._id]: { ...(taskDraft[list._id] || {}), title: e.target.value } })}
                    placeholder="New task…"
                    maxLength={300}
                  />
                  <input
                    value={(taskDraft[list._id] || {}).assigneeId || ''}
                    onChange={(e) => setTaskDraft({ ...taskDraft, [list._id]: { ...(taskDraft[list._id] || {}), assigneeId: e.target.value } })}
                    placeholder="Assignee user id (optional)"
                  />
                  <input
                    type="date"
                    value={(taskDraft[list._id] || {}).dueDate || ''}
                    onChange={(e) => setTaskDraft({ ...taskDraft, [list._id]: { ...(taskDraft[list._id] || {}), dueDate: e.target.value } })}
                  />
                  <button className="btn small primary" onClick={() => addTask(list._id, folderDetail._id)}>Add task</button>
                </div>
              </div>
            ))}
            <div className="doc-task-add">
              <input
                value={newListTitle}
                onChange={(e) => setNewListTitle(e.target.value)}
                placeholder="New task list title…"
                maxLength={200}
              />
              <button className="btn small ghost" onClick={() => createTaskList(folderDetail._id)}>Create list</button>
            </div>
          </div>
        </div>
      )}

      {shareTarget && (
        <div className="modal-backdrop" onClick={() => setShareTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Share “{shareTarget.item.name || shareTarget.item.title}”</h3>
            <label>
              With a person
              <input value={shareQuery} onChange={(e) => searchShareUsers(e.target.value)} placeholder="Search by name or email…" />
            </label>
            {shareResults.length > 0 && (
              <div className="invite-results">
                {shareResults.map((u) => (
                  <button type="button" key={u._id} className="mini-btn" onClick={() => applyShare({ userIds: [u._id] })}>
                    ＋ {u.username}
                  </button>
                ))}
              </div>
            )}
            <label>
              Or with everyone in a conversation
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) applyShare({ conversationId: e.target.value });
                }}
              >
                <option value="">Choose a conversation…</option>
                {myConversations.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.groupName || (c.type === 'channel' ? '📣 Channel' : 'Conversation')}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setShareTarget(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
