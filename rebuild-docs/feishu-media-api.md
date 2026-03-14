# Feishu Media API Reference

## Image API

### Download an image

```
GET /open-apis/im/v1/images/:image_key
```

- **Auth**: Bearer token (tenant_access_token or user_access_token)
- **Response**: Binary stream (`responseType: "stream"`)
- **Limits**: Max 10 MB per image

**Node SDK**:
```typescript
const resp = await client.im.image.get({ path: { image_key: 'img_v2_xxx' } });
// resp.data is a Readable stream
await pipeline(resp.data, fs.createWriteStream('/tmp/img.jpg'));
```

**Message content format** (message_type = `image`):
```json
{ "image_key": "img_v2_xxx" }
```

---

### Upload an image

```
POST /open-apis/im/v1/images
Content-Type: multipart/form-data
```

| Field | Type | Description |
|---|---|---|
| `image_type` | string | Must be `"message"` for chat images |
| `image` | file | Raw binary data, max 10 MB |

**Response**:
```json
{ "code": 0, "data": { "image_key": "img_v2_xxx" } }
```

**Node SDK**:
```typescript
const { data } = await client.im.image.create({
  data: {
    image_type: 'message',
    image: fs.createReadStream('/tmp/img.jpg'),
  },
});
const imageKey = data.image_key; // use in send-message payload
```

---

## File API

### Download a file

```
GET /open-apis/im/v1/files/:file_key
```

- **Auth**: Bearer token
- **Response**: Binary stream
- **Limits**: Max 30 MB per file

Supported file types: `mp4`, `pdf`, `doc`, `xls`, `ppt`, `stream` (generic binary).

**Node SDK**:
```typescript
const resp = await client.im.file.get({ path: { file_key: 'file_xxx' } });
await pipeline(resp.data, fs.createWriteStream('/tmp/file.pdf'));
```

**Message content format** (message_type = `file`):
```json
{ "file_key": "file_xxx", "file_name": "report.pdf" }
```

---

### Upload a file

```
POST /open-apis/im/v1/files
Content-Type: multipart/form-data
```

| Field | Type | Description |
|---|---|---|
| `file_type` | string | `mp4`, `pdf`, `doc`, `xls`, `ppt`, `stream` |
| `file_name` | string | Original file name (with extension) |
| `file` | file | Raw binary data, max 30 MB |

**Response**:
```json
{ "code": 0, "data": { "file_key": "file_xxx" } }
```

**Node SDK**:
```typescript
const { data } = await client.im.file.create({
  data: {
    file_type: 'pdf',
    file_name: 'report.pdf',
    file: fs.createReadStream('/tmp/report.pdf'),
  },
});
const fileKey = data.file_key;
```

---

## Sending Messages With Media

### Send an image message

```typescript
await client.im.message.create({
  params: { receive_id_type: 'chat_id' },
  data: {
    receive_id: 'oc_xxx',
    msg_type: 'image',
    content: JSON.stringify({ image_key: 'img_v2_xxx' }),
  },
});
```

### Send a file message

```typescript
await client.im.message.create({
  params: { receive_id_type: 'chat_id' },
  data: {
    receive_id: 'oc_xxx',
    msg_type: 'file',
    content: JSON.stringify({ file_key: 'file_xxx' }),
  },
});
```

### Post (rich text) with embedded image

```typescript
const postContent = {
  zh_cn: {
    title: '标题',
    content: [
      [{ tag: 'text', text: '正文' }],
      [{ tag: 'img', image_key: 'img_v2_xxx', width: 640, height: 480 }],
    ],
  },
};

await client.im.message.create({
  params: { receive_id_type: 'chat_id' },
  data: {
    receive_id: 'oc_xxx',
    msg_type: 'post',
    content: JSON.stringify(postContent),
  },
});
```

**Post block with url-linked image**:
```json
{ "tag": "img", "image_key": "img_v2_xxx", "width": 300, "height": 200 }
```

---

## Message Reactions

```typescript
// Add reaction
await client.im.messageReaction.create({
  path: { message_id: 'om_xxx' },
  data: { reaction_type: { emoji_type: 'Typing' } },
});

// Remove reaction
await client.im.messageReaction.delete({
  path: { message_id: 'om_xxx', reaction_id: 'react_xxx' },
});
```

**Common emoji_type values**:

| emoji_type | Display |
|---|---|
| `THUMBSUP` | 👍 |
| `Typing` | ⌨️ typing indicator |
| `DONE` | ✅ |
| `QMARK` | ❓ |
| `HAHA` | 😄 |
| `CRY` | 😢 |

---

## Notes

- `image_key` format: `img_v2_xxxxxxxx`
- `file_key` format: `file_xxxxxxxx`
- Both keys are immutable once created; re-use across messages is allowed.
- Images downloaded via API are full-resolution originals.
- Large files (>5 MB) may timeout under slow network conditions; implement retry logic.
- Temp-file cleanup should happen in a `finally` block after Codex processing completes.
