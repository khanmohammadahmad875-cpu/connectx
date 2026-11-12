# ConnectX — Database Design (MongoDB)

Six core/supporting collections. **Status: all models implemented** in
`server/src/models/` exactly as designed below.

## users

| Field | Type | Purpose |
|---|---|---|
| _id | ObjectId | Unique user ID |
| username | String | Display name |
| email | String (unique, normalized) | Login email |
| password | String | **Hashed** password (bcrypt) |
| profilePicture | String | Image URL |
| bio | String | User description |
| status | String | Online/offline |
| lastSeen | Date | Last active time |
| role | String | `user` / `admin` |
| isBlocked | Boolean | Account status (suspended) |
| createdAt | Date | Registration date |

## conversations

| Field | Type | Purpose |
|---|---|---|
| _id | ObjectId | Conversation ID |
| type | String | `private` / `group` |
| participants | Array&lt;ObjectId&gt; | Member user IDs |
| groupName | String | Group name (groups only) |
| groupImage | String | Group image URL |
| admins | Array&lt;ObjectId&gt; | Group admin IDs |
| createdBy | ObjectId | Creator |
| lastMessage | ObjectId | Latest message reference |
| createdAt | Date | Creation date |

## messages

| Field | Type | Purpose |
|---|---|---|
| _id | ObjectId | Message ID |
| conversationId | ObjectId | Conversation reference |
| senderId | ObjectId | Sender reference |
| content | String | Message text |
| messageType | String | `text` / `image` / `file` |
| attachmentUrl | String | File URL |
| replyTo | ObjectId | Replied-to message |
| reactions | Array | Message reactions |
| readBy | Array&lt;ObjectId&gt; | Users who read it |
| deliveredTo | Array&lt;ObjectId&gt; | Users who received it |
| editedAt / deletedAt | Date | Edit / soft-delete timestamps |
| createdAt | Date | Message timestamp |

## Supporting collections

- **ConversationMembers** — conversationId, userId, role, joinedAt,
  lastReadMessageId, muted. Per-user read state and group permissions.
- **Notifications** — recipientId, senderId, type, conversationId, messageId,
  isRead, createdAt.
- **Reports** — reportedBy, reportedUser, messageId, reason, status, createdAt.

## Relationships

```
USERS ──< CONVERSATIONS (participants) ──< MESSAGES
  │                                              ▲
  └──── ConversationMembers (membership + read state)
        Notifications · Reports (supporting)
```

## Database rules

1. Never store plaintext passwords.
2. Unique index on normalized email.
3. Index messages by `conversationId` + `createdAt`; paginate message loads.
4. Never embed every message inside the conversation document.
5. Validate conversation membership before allowing message access.
6. Separate membership model for group permissions and per-user read state.
7. Private conversations are unique per participant pair (no duplicates).
8. Message creation is idempotent — client retries must not duplicate messages.
