import express from "express";
import Replicate from "replicate";
import fetch from "node-fetch";
import FormData from "form-data";
import dotenv from "dotenv";
import multer from "multer";

// 加载环境变量
dotenv.config();

const app = express();
app.use(express.json());

// 配置multer用于文件上传
const upload = multer({ storage: multer.memoryStorage() });

// 初始化Replicate客户端
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// 存储预测状态的简单内存存储（生产环境应使用数据库）
const predictions = new Map();

/**
 * POST /generate - 生成音乐
 * 接收音乐参数和图片URL，返回预测ID
 */
app.post("/generate", async (req, res) => {
  try {
    const { prompt, lyrics, imageUrl } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: "缺少必需的prompt参数" });
    }

    // 调用 Replicate API 生成音频
    const prediction = await replicate.run("minimax/music-1.5", {
      input: { 
        prompt,
        ...(lyrics && { lyrics }),
        ...(imageUrl && { image_url: imageUrl })
      },
    });
    
    // 存储预测信息
    predictions.set(prediction.id, {
      id: prediction.id,
      status: prediction.status,
      createdAt: new Date().toISOString(),
      prompt,
      lyrics,
      imageUrl,
      result: null
    });

    res.json({
      predictionId: prediction.id,
      status: prediction.status,
      message: "音乐生成任务已提交"
    });
  } catch (err) {
    console.error("生成音乐错误:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /status/:predictionId - 查询生成状态
 * 返回预测状态和结果
 */
app.get("/status/:predictionId", async (req, res) => {
  try {
    const { predictionId } = req.params;
    
    if (!predictionId) {
      return res.status(400).json({ error: "缺少predictionId参数" });
    }

    // 从Replicate获取最新状态
    let prediction;
    try {
      prediction = await replicate.predictions.get(predictionId);
    } catch (err) {
      return res.status(404).json({ error: "预测ID不存在" });
    }

    // 更新本地存储
    const localData = predictions.get(predictionId) || {};
    localData.status = prediction.status;
    localData.updatedAt = new Date().toISOString();
    
    // 如果完成，处理结果
    if (prediction.status === "succeeded" && prediction.output) {
      const audioUrl = prediction.output?.[0]?.url || prediction.output?.[0];
      
      if (audioUrl && !localData.result) {
        // 下载音频文件
        const audioRes = await fetch(audioUrl);
        const buffer = await audioRes.arrayBuffer();

        // 上传到 Cloudinary
        const formData = new FormData();
        formData.append("file", Buffer.from(buffer), { filename: "music.mp3" });
        formData.append("upload_preset", process.env.CLOUDINARY_UPLOAD_PRESET);

        const uploadRes = await fetch(
          `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
          { method: "POST", body: formData }
        );

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          localData.result = {
            audioUrl: uploadData.secure_url,
            originalUrl: audioUrl
          };
        }
      }
    }
    
    // 如果失败，记录错误
    if (prediction.status === "failed") {
      localData.error = prediction.error;
    }
    
    predictions.set(predictionId, localData);

    res.json({
      predictionId,
      status: prediction.status,
      createdAt: localData.createdAt,
      updatedAt: localData.updatedAt,
      ...(localData.result && { result: localData.result }),
      ...(localData.error && { error: localData.error }),
      logs: prediction.logs || []
    });
  } catch (err) {
    console.error("查询状态错误:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /upload - 上传图片
 * 接收图片文件，返回图片URL
 */
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "没有上传图片文件" });
    }

    // 上传到 Cloudinary
    const formData = new FormData();
    formData.append("file", req.file.buffer, { 
      filename: req.file.originalname,
      contentType: req.file.mimetype 
    });
    formData.append("upload_preset", process.env.CLOUDINARY_UPLOAD_PRESET);

    const uploadRes = await fetch(
      `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: "POST", body: formData }
    );

    if (!uploadRes.ok) {
      throw new Error(`Cloudinary 上传失败: ${uploadRes.statusText}`);
    }

    const uploadData = await uploadRes.json();

    res.json({
      imageUrl: uploadData.secure_url,
      publicId: uploadData.public_id,
      format: uploadData.format,
      size: uploadData.bytes
    });
  } catch (err) {
    console.error("上传图片错误:", err);
    res.status(500).json({ error: err.message });
  }
});

// 健康检查端点
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    service: "Musai Backend API"
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error("未处理的错误:", err);
  res.status(500).json({ error: "服务器内部错误" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Musai后端服务启动，监听端口 ${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
});