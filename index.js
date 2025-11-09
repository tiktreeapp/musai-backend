import express from "express";
import Replicate from "replicate";
import fetch from "node-fetch";
import FormData from "form-data";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// 加载环境变量
dotenv.config();

const app = express();
app.use(express.json());

// 获取当前目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 创建本地缓存目录
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 配置multer用于文件上传（保存到本地）
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// 初始化Replicate客户端
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// 存储预测状态的简单内存存储（生产环境应使用数据库）
const predictions = new Map();

/**
 * POST /generate - 生成音乐
 * 接收前端发送的参数，转换为Replicate API格式并调用
 */
app.post("/generate", async (req, res) => {
  try {
    console.log("🔍 Generate请求体:", JSON.stringify(req.body, null, 2));
    
    const { 
      // 官方格式参数
      prompt, 
      lyrics, 
      imageUrl,
      bitrate = 256000,
      sample_rate = 44100,
      audio_format = "mp3",
      // 前端发送的格式参数
      input: frontendInput,
      style,
      mode,
      speed,
      instrumentation,
      vocal
    } = req.body;
    
    // 处理前端发送的参数格式
    let finalLyrics = lyrics;
    let finalPrompt = prompt;
    
    // 如果前端使用的是分离参数格式
    if (!prompt && !lyrics && frontendInput) {
      // 将input作为lyrics
      finalLyrics = frontendInput;
      
      // 组合其他参数为prompt
      const promptParts = [];
      if (style) promptParts.push(`${style}`);
      if (mode) promptParts.push(`${mode}`);
      if (speed) promptParts.push(`${speed}`);
      if (instrumentation) promptParts.push(`${instrumentation}`);
      if (vocal) promptParts.push(`${vocal}`);
      
      finalPrompt = promptParts.join(", ");
      
      console.log("🔍 参数转换 - input -> lyrics:", finalLyrics);
      console.log("🔍 参数转换 - 组合prompt:", finalPrompt);
    }
    
    console.log("🔍 最终参数 - prompt:", finalPrompt, "lyrics:", finalLyrics, "imageUrl:", imageUrl);
    
    if (!finalPrompt) {
      console.log("❌ 缺少prompt参数");
      return res.status(400).json({ error: "缺少必需的prompt参数" });
    }

    // 使用Replicate SDK调用
    const input = {
      ...(finalLyrics && { lyrics: finalLyrics }),
      ...(finalPrompt && { prompt: finalPrompt }),
      ...(imageUrl && { image_url: imageUrl }),
      bitrate,
      sample_rate,
      audio_format
    };
    
    console.log("🔍 Replicate SDK输入:", JSON.stringify(input, null, 2));
    
    const prediction = await replicate.run("minimax/music-1.5", { input });
    console.log("✅ Replicate SDK响应:", JSON.stringify(prediction, null, 2));
    
    // 存储预测信息
    predictions.set(prediction.id, {
      id: prediction.id,
      status: prediction.status,
      createdAt: new Date().toISOString(),
      prompt: finalPrompt,
      lyrics: finalLyrics,
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

    // 从Replicate SDK获取最新状态
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
      // 根据官方API示例，output是一个对象，可以使用url()方法
      let audioUrl;
      try {
        audioUrl = prediction.output.url();
      } catch (err) {
        // 如果url()方法不可用，尝试其他方式
        audioUrl = prediction.output?.[0]?.url || prediction.output?.[0];
      }
      
      if (audioUrl && !localData.result) {
        // 下载音频文件到本地
        const audioRes = await fetch(audioUrl);
        const buffer = await audioRes.arrayBuffer();
        
        // 保存到本地
        const audioFilename = `music-${predictionId}.mp3`;
        const audioPath = path.join(uploadsDir, audioFilename);
        fs.writeFileSync(audioPath, Buffer.from(buffer));
        
        console.log("🎵 音频文件保存到本地:", audioPath);
        
        localData.result = {
          audioUrl: `/uploads/${audioFilename}`,
          originalUrl: audioUrl,
          localPath: audioPath
        };
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
 * 接收图片文件，返回本地图片URL
 */
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "没有上传图片文件" });
    }

    console.log("📷 图片上传成功:", req.file.filename);
    
    // 返回本地文件URL（相对于服务器根目录）
    const imageUrl = `/uploads/${req.file.filename}`;
    
    res.json({
      imageUrl: imageUrl,
      localPath: req.file.path,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (err) {
    console.error("上传图片错误:", err);
    res.status(500).json({ error: err.message });
  }
});

// 静态文件服务 - 提供本地图片访问
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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