const express = require('express');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const DocFolder = require('../models/DocFolder');
const DocFile = require('../models/DocFile');
const DocNote = require('../models/DocNote');
const TaskList = require('../models/TaskList');
const DocTask = require('../models/DocTask');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { UPLOAD_DIR } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

/**
 * Access model (module 32), enforced here on EVERY read and download:
 *  - owner: full control (rename, delete, share).
 *  - editor: sharedWith users + members of sharedConversations (+, for task
 *    lists inside a folder, anyone with folder access). Editors can read,
 *    add files/notes/tasks and update tasks they own or are assigned.
 *  - everyone else: 403.
 */

async function isConversationMember(conversationId, userId) {
  const member = await ConversationMember.findOne({ conversationId, userId }).select('_id');
  return !!member;
}

// Normalises an id-like value (ObjectId, raw string, or a POPULATED
// document) to its hex string. A populated doc's .toString() is NOT its
// id, so comparisons must go through this helper.
function asId(value) {
  if (value == null) return '';
  if (typeof value === 'object' && '_id' in value && typeof value._id !== 'undefined') {
    return value._id.toString();
  }
  return value.toString();
}

async function sharingAccess(ownerId, sharedWith, sharedConversations, userId) {
  if (asId(ownerId) === asId(userId)) return 'owner';
  if ((sharedWith || []).some((id) => asId(id) === asId(userId))) return 'editor';
  for (const conversationId of sharedConversations || []) {
    if (await isConversationMember(conversationId, userId)) return 'editor';
  }
  return null;
}

async function folderAccess(folder, userId) {
  return sharingAccess(folder.owner, folder.sharedWith, folder.sharedConversations, userId);
}

async function taskListAccess(list, userId) {
  const direct = await sharingAccess(list.owner, list.sharedWith, list.sharedConversations, userId);
  if (direct) return direct;
  if (list.folder) {
    const folder = await DocFolder.findById(list.folder);
    if (folder) return folderAccess(folder, userId);
  }
  return null;
}

async function loadFolder(req, res) {
  const folder = await DocFolder.findById(req.params.id);
  if (!folder) {
    res.status(404).json({ message: 'Folder not found' });
    return null;
  }
  const access = await folderAccess(folder, req.user._id);
  if (!access) {
    res.status(403).json({ message: 'You do not have access to this folder' });
    return null;
  }
  return { folder, access };
}

async function loadTaskList(req, res, idParam = 'id') {
  const list = await TaskList.findById(req.params[idParam]);
  if (!list) {
    res.status(404).json({ message: 'Task list not found' });
    return null;
  }
  const access = await taskListAccess(list, req.user._id);
  if (!access) {
    res.status(403).json({ message: 'You do not have access to this task list' });
    return null;
  }
  return { list, access };
}

async function myConversationIds(userId) {
  const memberships = await ConversationMember.find({ userId }).select('conversationId');
  return memberships.map((m) => m.conversationId);
}

function serializeTask(task) {
  return task;
}

// --- Folders -----------------------------------------------------------------

router.post(
  '/folders',
  validate(z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().nullable().optional() })),
  async (req, res, next) => {
    try {
      let parent = null;
      if (req.body.parentId) {
        const loaded = await loadFolder({ params: { id: req.body.parentId }, user: req.user }, res);
        if (!loaded) return undefined;
        parent = loaded.folder._id;
      }
      const folder = await DocFolder.create({ owner: req.user._id, name: req.body.name, parent });
      return res.status(201).json({ folder });
    } catch (err) {
      return next(err);
    }
  }
);

router.get('/folders', async (req, res, next) => {
  try {
    const conversationIds = await myConversationIds(req.user._id);
    const folders = await DocFolder.find({
      $or: [
        { owner: req.user._id },
        { sharedWith: req.user._id },
        { sharedConversations: { $in: conversationIds } },
      ],
    })
      .sort({ createdAt: -1 })
      .populate('owner', 'username profilePicture');
    const withAccess = [];
    for (const folder of folders) {
      const access = await folderAccess(folder, req.user._id);
      if (access) withAccess.push({ ...folder.toObject(), access });
    }
    return res.json({ folders: withAccess });
  } catch (err) {
    return next(err);
  }
});

router.get('/folders/:id', async (req, res, next) => {
  try {
    const loaded = await loadFolder(req, res);
    if (!loaded) return undefined;
    const { folder, access } = loaded;
    const [files, notes, taskLists] = await Promise.all([
      DocFile.find({ folder: folder._id }).sort({ createdAt: -1 }).populate('uploadedBy', 'username'),
      DocNote.find({ folder: folder._id }).sort({ updatedAt: -1 }).populate('author', 'username'),
      TaskList.find({ folder: folder._id }).sort({ createdAt: -1 }),
    ]);
    const listsWithTasks = [];
    for (const list of taskLists) {
      const tasks = await DocTask.find({ list: list._id })
        .sort({ createdAt: 1 })
        .populate('assignee', 'username profilePicture');
      listsWithTasks.push({ ...list.toObject(), tasks });
    }
    return res.json({ folder: { ...folder.toObject(), access }, files, notes, taskLists: listsWithTasks });
  } catch (err) {
    return next(err);
  }
});

router.patch(
  '/folders/:id',
  validate(z.object({ name: z.string().trim().min(1).max(120) })),
  async (req, res, next) => {
    try {
      const loaded = await loadFolder(req, res);
      if (!loaded) return undefined;
      if (loaded.access !== 'owner') {
        return res.status(403).json({ message: 'Only the folder owner can rename it' });
      }
      loaded.folder.name = req.body.name;
      await loaded.folder.save();
      return res.json({ folder: loaded.folder });
    } catch (err) {
      return next(err);
    }
  }
);

router.delete('/folders/:id', async (req, res, next) => {
  try {
    const loaded = await loadFolder(req, res);
    if (!loaded) return undefined;
    if (loaded.access !== 'owner') {
      return res.status(403).json({ message: 'Only the folder owner can delete it' });
    }
    const { folder } = loaded;
    const lists = await TaskList.find({ folder: folder._id }).select('_id');
    await DocTask.deleteMany({ list: { $in: lists.map((l) => l._id) } });
    await TaskList.deleteMany({ folder: folder._id });
    await DocFile.deleteMany({ folder: folder._id });
    await DocNote.deleteMany({ folder: folder._id });
    await folder.deleteOne();
    return res.json({ message: 'Folder deleted' });
  } catch (err) {
    return next(err);
  }
});

const shareSchema = z.object({
  userIds: z.array(z.string()).max(50).optional().default([]),
  conversationId: z.string().nullable().optional(),
});

async function applySharing(target, req, res) {
  for (const userId of req.body.userIds) {
    const user = await User.findById(userId).select('_id');
    if (!user) {
      res.status(400).json({ message: `User not found: ${userId}` });
      return false;
    }
    if (!target.sharedWith.some((id) => id.toString() === userId)) target.sharedWith.push(userId);
  }
  if (req.body.conversationId) {
    const conversation = await Conversation.findById(req.body.conversationId).select('_id');
    if (!conversation) {
      res.status(400).json({ message: 'Conversation not found' });
      return false;
    }
    if (!(await isConversationMember(conversation._id, req.user._id))) {
      res.status(403).json({ message: 'You are not a member of that conversation' });
      return false;
    }
    if (!target.sharedConversations.some((id) => id.toString() === req.body.conversationId)) {
      target.sharedConversations.push(req.body.conversationId);
    }
  }
  return true;
}

router.post('/folders/:id/share', validate(shareSchema), async (req, res, next) => {
  try {
    const loaded = await loadFolder(req, res);
    if (!loaded) return undefined;
    if (loaded.access !== 'owner') {
      return res.status(403).json({ message: 'Only the folder owner can change sharing' });
    }
    if (!(await applySharing(loaded.folder, req, res))) return undefined;
    await loaded.folder.save();
    return res.json({ folder: loaded.folder });
  } catch (err) {
    return next(err);
  }
});

// --- Files -------------------------------------------------------------------

router.post(
  '/folders/:id/files',
  validate(
    z.object({
      name: z.string().trim().min(1).max(200),
      url: z.string().min(1).max(2000),
      size: z.number().int().min(0).optional().default(0),
      mimeType: z.string().max(120).optional().default(''),
    })
  ),
  async (req, res, next) => {
    try {
      const loaded = await loadFolder(req, res);
      if (!loaded) return undefined;
      const file = await DocFile.create({
        folder: loaded.folder._id,
        uploadedBy: req.user._id,
        name: req.body.name,
        url: req.body.url,
        size: req.body.size,
        mimeType: req.body.mimeType,
      });
      return res.status(201).json({ file });
    } catch (err) {
      return next(err);
    }
  }
);

// The access-controlled download path: folder access is verified first,
// then a locally stored file is streamed (or a remote/Cloudinary URL is
// handed out as a redirect). Raw /uploads URLs stay as-is for chat media.
router.get('/files/:id/download', async (req, res, next) => {
  try {
    const file = await DocFile.findById(req.params.id);
    if (!file) return res.status(404).json({ message: 'File not found' });
    const folder = await DocFolder.findById(file.folder);
    if (!folder) return res.status(404).json({ message: 'Folder not found' });
    const access = await folderAccess(folder, req.user._id);
    if (!access) {
      return res.status(403).json({ message: 'You do not have access to this file' });
    }
    const marker = '/uploads/';
    const idx = file.url.indexOf(marker);
    if (idx !== -1) {
      const filename = decodeURIComponent(file.url.slice(idx + marker.length).split(/[?#]/)[0]);
      const filePath = path.join(UPLOAD_DIR, path.basename(filename));
      if (fs.existsSync(filePath)) {
        return res.download(filePath, file.name);
      }
    }
    if (/^https?:\/\//i.test(file.url)) return res.redirect(file.url);
    return res.status(404).json({ message: 'File bytes are no longer available' });
  } catch (err) {
    return next(err);
  }
});

router.delete('/files/:id', async (req, res, next) => {
  try {
    const file = await DocFile.findById(req.params.id);
    if (!file) return res.status(404).json({ message: 'File not found' });
    const folder = await DocFolder.findById(file.folder);
    if (!folder) return res.status(404).json({ message: 'Folder not found' });
    const access = await folderAccess(folder, req.user._id);
    if (!access) return res.status(403).json({ message: 'You do not have access to this file' });
    const isUploader = file.uploadedBy.toString() === req.user._id.toString();
    if (access !== 'owner' && !isUploader) {
      return res.status(403).json({ message: 'Only the uploader or folder owner can delete this file' });
    }
    await file.deleteOne();
    return res.json({ message: 'File removed from folder' });
  } catch (err) {
    return next(err);
  }
});

// --- Notes -------------------------------------------------------------------

router.post(
  '/folders/:id/notes',
  validate(z.object({ title: z.string().trim().min(1).max(200), content: z.string().max(20000).optional().default('') })),
  async (req, res, next) => {
    try {
      const loaded = await loadFolder(req, res);
      if (!loaded) return undefined;
      const note = await DocNote.create({
        folder: loaded.folder._id,
        author: req.user._id,
        title: req.body.title,
        content: req.body.content,
      });
      return res.status(201).json({ note });
    } catch (err) {
      return next(err);
    }
  }
);

router.patch(
  '/notes/:id',
  validate(
    z.object({
      title: z.string().trim().min(1).max(200).optional(),
      content: z.string().max(20000).optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const note = await DocNote.findById(req.params.id);
      if (!note) return res.status(404).json({ message: 'Note not found' });
      const folder = await DocFolder.findById(note.folder);
      if (!folder) return res.status(404).json({ message: 'Folder not found' });
      const access = await folderAccess(folder, req.user._id);
      if (!access) return res.status(403).json({ message: 'You do not have access to this note' });
      if (req.body.title !== undefined) note.title = req.body.title;
      if (req.body.content !== undefined) note.content = req.body.content;
      await note.save();
      return res.json({ note });
    } catch (err) {
      return next(err);
    }
  }
);

router.delete('/notes/:id', async (req, res, next) => {
  try {
    const note = await DocNote.findById(req.params.id);
    if (!note) return res.status(404).json({ message: 'Note not found' });
    const folder = await DocFolder.findById(note.folder);
    if (!folder) return res.status(404).json({ message: 'Folder not found' });
    const access = await folderAccess(folder, req.user._id);
    if (!access) return res.status(403).json({ message: 'You do not have access to this note' });
    const isAuthor = note.author.toString() === req.user._id.toString();
    if (access !== 'owner' && !isAuthor) {
      return res.status(403).json({ message: 'Only the author or folder owner can delete this note' });
    }
    await note.deleteOne();
    return res.json({ message: 'Note deleted' });
  } catch (err) {
    return next(err);
  }
});

// --- Task lists & tasks ------------------------------------------------------

router.post(
  '/task-lists',
  validate(z.object({ title: z.string().trim().min(1).max(200), folderId: z.string().nullable().optional() })),
  async (req, res, next) => {
    try {
      let folder = null;
      if (req.body.folderId) {
        const loaded = await loadFolder({ params: { id: req.body.folderId }, user: req.user }, res);
        if (!loaded) return undefined;
        folder = loaded.folder._id;
      }
      const list = await TaskList.create({ owner: req.user._id, title: req.body.title, folder });
      return res.status(201).json({ taskList: list });
    } catch (err) {
      return next(err);
    }
  }
);

router.get('/task-lists', async (req, res, next) => {
  try {
    const conversationIds = await myConversationIds(req.user._id);
    const lists = await TaskList.find({
      $or: [
        { owner: req.user._id },
        { sharedWith: req.user._id },
        { sharedConversations: { $in: conversationIds } },
      ],
    }).sort({ createdAt: -1 });
    // Include lists that live in folders shared with me.
    const sharedFolders = await DocFolder.find({
      $or: [{ sharedWith: req.user._id }, { sharedConversations: { $in: conversationIds } }],
    }).select('_id');
    if (sharedFolders.length) {
      const folderLists = await TaskList.find({
        folder: { $in: sharedFolders.map((f) => f._id) },
        _id: { $nin: lists.map((l) => l._id) },
      }).sort({ createdAt: -1 });
      lists.push(...folderLists);
    }
    return res.json({ taskLists: lists });
  } catch (err) {
    return next(err);
  }
});

router.get('/task-lists/:id', async (req, res, next) => {
  try {
    const loaded = await loadTaskList(req, res);
    if (!loaded) return undefined;
    const tasks = await DocTask.find({ list: loaded.list._id })
      .sort({ createdAt: 1 })
      .populate('assignee', 'username profilePicture')
      .populate('createdBy', 'username');
    return res.json({ taskList: loaded.list, tasks: tasks.map(serializeTask), access: loaded.access });
  } catch (err) {
    return next(err);
  }
});

router.post('/task-lists/:id/share', validate(shareSchema), async (req, res, next) => {
  try {
    const loaded = await loadTaskList(req, res);
    if (!loaded) return undefined;
    if (loaded.access !== 'owner') {
      return res.status(403).json({ message: 'Only the list owner can change sharing' });
    }
    if (!(await applySharing(loaded.list, req, res))) return undefined;
    await loaded.list.save();
    return res.json({ taskList: loaded.list });
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/task-lists/:id/tasks',
  validate(
    z.object({
      title: z.string().trim().min(1).max(300),
      description: z.string().max(2000).optional().default(''),
      assigneeId: z.string().nullable().optional(),
      dueDate: z.string().datetime().nullable().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const loaded = await loadTaskList(req, res);
      if (!loaded) return undefined;
      let assignee = null;
      if (req.body.assigneeId) {
        const user = await User.findById(req.body.assigneeId).select('_id');
        if (!user) return res.status(400).json({ message: 'Assignee not found' });
        // Assignees must be people the list is shared with (or the owner).
        const assigneeAccess = await taskListAccess(loaded.list, user._id);
        if (!assigneeAccess) {
          return res.status(400).json({ message: 'The assignee must have access to this list — share the list with them first' });
        }
        assignee = user._id;
      }
      const task = await DocTask.create({
        list: loaded.list._id,
        title: req.body.title,
        description: req.body.description,
        assignee,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        createdBy: req.user._id,
      });
      await task.populate('assignee', 'username profilePicture');
      return res.status(201).json({ task });
    } catch (err) {
      return next(err);
    }
  }
);

router.patch(
  '/tasks/:id',
  validate(
    z.object({
      title: z.string().trim().min(1).max(300).optional(),
      description: z.string().max(2000).optional(),
      status: z.enum(['todo', 'in-progress', 'done']).optional(),
      assigneeId: z.string().nullable().optional(),
      dueDate: z.string().datetime().nullable().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const task = await DocTask.findById(req.params.id);
      if (!task) return res.status(404).json({ message: 'Task not found' });
      const list = await TaskList.findById(task.list);
      if (!list) return res.status(404).json({ message: 'Task list not found' });
      const access = await taskListAccess(list, req.user._id);
      if (!access) return res.status(403).json({ message: 'You do not have access to this task' });

      const isOwner = access === 'owner';
      const isAssignee = task.assignee && task.assignee.toString() === req.user._id.toString();
      // Status: owner or the task's assignee. Other fields: owner (or the
      // assignee for their own task's status only).
      if (req.body.status !== undefined) {
        if (!isOwner && !isAssignee) {
          return res.status(403).json({ message: 'Only the list owner or the assignee can change the status' });
        }
        task.status = req.body.status;
      }
      const editsOtherFields =
        req.body.title !== undefined ||
        req.body.description !== undefined ||
        req.body.assigneeId !== undefined ||
        req.body.dueDate !== undefined;
      if (editsOtherFields && !isOwner) {
        return res.status(403).json({ message: 'Only the list owner can edit task details' });
      }
      if (req.body.title !== undefined) task.title = req.body.title;
      if (req.body.description !== undefined) task.description = req.body.description;
      if (req.body.dueDate !== undefined) {
        task.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
      }
      if (req.body.assigneeId !== undefined) {
        if (req.body.assigneeId) {
          const user = await User.findById(req.body.assigneeId).select('_id');
          if (!user) return res.status(400).json({ message: 'Assignee not found' });
          const assigneeAccess = await taskListAccess(list, user._id);
          if (!assigneeAccess) {
            return res.status(400).json({ message: 'The assignee must have access to this list' });
          }
          task.assignee = user._id;
        } else {
          task.assignee = null;
        }
      }
      await task.save();
      await task.populate('assignee', 'username profilePicture');
      return res.json({ task });
    } catch (err) {
      return next(err);
    }
  }
);

router.delete('/tasks/:id', async (req, res, next) => {
  try {
    const task = await DocTask.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    const list = await TaskList.findById(task.list);
    if (!list) return res.status(404).json({ message: 'Task list not found' });
    const access = await taskListAccess(list, req.user._id);
    if (!access) return res.status(403).json({ message: 'You do not have access to this task' });
    if (access !== 'owner' && task.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the list owner or the task creator can delete it' });
    }
    await task.deleteOne();
    return res.json({ message: 'Task deleted' });
  } catch (err) {
    return next(err);
  }
});

// "My tasks": everything assigned to me that is not done, across every list
// I can access. Powers the Home dashboard widget.
router.get('/my-tasks', async (req, res, next) => {
  try {
    const tasks = await DocTask.find({ assignee: req.user._id, status: { $ne: 'done' } })
      .sort({ dueDate: 1, createdAt: 1 })
      .limit(50)
      .populate('list', 'title');
    const visible = [];
    for (const task of tasks) {
      const list = await TaskList.findById(task.list);
      if (list && (await taskListAccess(list, req.user._id))) visible.push(task);
    }
    return res.json({ tasks: visible });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.folderAccess = folderAccess;
module.exports.taskListAccess = taskListAccess;
