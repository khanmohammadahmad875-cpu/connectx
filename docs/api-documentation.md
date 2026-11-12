# ConnectX — API Documentation

REST handles data (auth, profiles, history). Socket.IO handles real-time
events. **Status: every endpoint in this document is implemented and verified**
by the end-to-end suite in `server/tests/e2e.cjs`.

## REST endpoints

| Method | Endpoint | Purpose | Milestone |
|---|---|---|---|
| GET | /api/health | Service + database status | 1 ✅ |
| POST | /api/auth/register | Register | 2 |
| POST | /api/auth/login | Login | 2 |
| POST | /api/auth/logout | Logout | 2 |
| POST | /api/auth/refresh | Refresh access token | 2 |
| GET | /api/users/me | Current profile | 3 |
| GET | /api/users/search | Search users | 3 |
| PATCH | /api/users/me | Update profile | 3 |
| POST | /api/conversations | Create conversation | 4 |
| GET | /api/conversations | List conversations | 4 |
| GET | /api/messages/:conversationId | Get messages (paginated) | 5 |
| POST | /api/messages | Create message | 5 |
| PATCH | /api/messages/:id | Edit message (own only) | 6 |
| DELETE | /api/messages/:id | Delete message (own only) | 6 |
| POST | /api/uploads | Upload file | 8 |

## Socket.IO events (Milestone 5+)

| Event | Direction | Purpose |
|---|---|---|
| connection | Client → Server | Connect (authenticated) |
| join_conversation | Client → Server | Join a conversation room |
| send_message | Client → Server | Send a message |
| new_message | Server → Client | Receive a message |
| typing_start / typing_stop | Client → Server | Typing indicators |
| message_delivered | Server → Client | Delivery status |
| message_read | Client → Server | Read receipt |
| user_online / user_offline | Server → Client | Presence |

**Security rule:** the server verifies authentication and conversation
membership for every sensitive socket event. A client-supplied sender ID or
room ID is never trusted.
