# Musai Backend API 文档

## 概述

Musai后端API提供了AI音乐生成服务，基于Replicate的Music-1.5模型，支持文本生成音乐和图片生成音乐功能。

## 基础URL

```
https://musai-backend.onrender.com
```

## 环境变量配置

在部署前，请确保设置以下环境变量：

```bash
REPLICATE_API_TOKEN=your_replicate_api_token
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
CLOUDINARY_UPLOAD_PRESET=musai_unsigned
PORT=3000
```

## API端点

### 1. 健康检查

**GET** `/health`

检查服务状态。

**响应示例：**
```json
{
  "status": "ok",
  "timestamp": "2025-01-09T12:00:00.000Z",
  "service": "Musai Backend API"
}
```

### 2. 生成音乐

**POST** `/generate`

提交音乐生成任务，返回预测ID。

**请求体：**
```json
{
  "prompt": "string",    // 必需，音乐描述文本
  "lyrics": "string",    // 可选，歌词文本
  "imageUrl": "string"   // 可选，图片URL（用于图片生成音乐）
}
```

**响应示例：**
```json
{
  "predictionId": "abc123def456",
  "status": "processing",
  "message": "音乐生成任务已提交"
}
```

### 3. 查询生成状态

**GET** `/status/{predictionId}`

查询音乐生成任务的状态和结果。

**路径参数：**
- `predictionId` - 预测ID

**响应示例：**
```json
{
  "predictionId": "abc123def456",
  "status": "succeeded",
  "createdAt": "2025-01-09T12:00:00.000Z",
  "updatedAt": "2025-01-09T12:05:00.000Z",
  "result": {
    "audioUrl": "https://res.cloudinary.com/dygx9d3gi/video/upload/v1234567890/music.mp3",
    "originalUrl": "https://replicate.delivery/example.mp3"
  },
  "logs": ["Processing started...", "Generating music..."]
}
```

**状态值说明：**
- `processing` - 正在处理
- `succeeded` - 生成成功
- `failed` - 生成失败
- `canceled` - 已取消

### 4. 上传图片

**POST** `/upload`

上传图片文件，返回图片URL。支持图片生成音乐功能。

**请求：**
- Content-Type: `multipart/form-data`
- 表单字段: `image` (文件)

**响应示例：**
```json
{
  "imageUrl": "https://res.cloudinary.com/dygx9d3gi/image/upload/v1234567890/sample.jpg",
  "publicId": "sample_abc123",
  "format": "jpg",
  "size": 123456
}
```

## 使用流程

1. **上传图片**（可选）：如果需要基于图片生成音乐，先使用`POST /upload`上传图片
2. **生成音乐**：使用`POST /generate`提交生成任务，获取predictionId
3. **查询状态**：使用`GET /status/{predictionId}`查询生成状态，直到状态为`succeeded`或`failed`
4. **获取结果**：生成成功后，从响应中获取音频URL

## 错误处理

所有API错误都会返回以下格式的响应：

```json
{
  "error": "错误描述信息"
}
```

常见HTTP状态码：
- `400` - 请求参数错误
- `404` - 资源不存在
- `500` - 服务器内部错误

## 注意事项

1. 音乐生成是异步过程，通常需要几分钟时间
2. 当前使用内存存储预测状态，重启服务会丢失数据（生产环境建议使用数据库）
3. 图片上传限制：最大文件大小10MB，支持常见图片格式
4. API调用频率限制：根据Replicate和Cloudinary的限制

## 示例代码

### JavaScript/Node.js

```javascript
// 1. 上传图片（可选）
const formData = new FormData();
formData.append('image', imageFile);

const uploadResponse = await fetch('https://musai-backend.onrender.com/upload', {
  method: 'POST',
  body: formData
});
const { imageUrl } = await uploadResponse.json();

// 2. 生成音乐
const generateResponse = await fetch('https://musai-backend.onrender.com/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: '欢快的流行音乐',
    lyrics: '这是我的歌词...',
    imageUrl: imageUrl // 可选
  })
});
const { predictionId } = await generateResponse.json();

// 3. 轮询状态
const checkStatus = async () => {
  const statusResponse = await fetch(`https://musai-backend.onrender.com/status/${predictionId}`);
  const status = await statusResponse.json();
  
  if (status.status === 'succeeded') {
    console.log('音乐生成完成:', status.result.audioUrl);
  } else if (status.status === 'failed') {
    console.error('生成失败:', status.error);
  } else {
    setTimeout(checkStatus, 5000); // 5秒后再次检查
  }
};

checkStatus();
```