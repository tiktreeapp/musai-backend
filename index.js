import express from "express";
import Replicate from "replicate";
import fetch from "node-fetch";
import FormData from "form-data";
import dotenv from "dotenv";

// 加载环境变量
dotenv.config();

const app = express();
app.use(express.json());

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

app.post("/generate", async (req, res) => {
  try {
    const { prompt, lyrics } = req.body;

    // 调用 Replicate API 生成音频
    const output = await replicate.run("minimax/music-1.5", {
      input: { prompt, lyrics },
    });

    // 获取音频文件 URL
    const audioUrl = output?.[0]?.url || output?.[0];
    if (!audioUrl) {
      return res.status(500).json({ error: "未能生成有效的音频文件 URL" });
    }

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

    if (!uploadRes.ok) {
      throw new Error(`Cloudinary 上传失败: ${uploadRes.statusText}`);
    }

    const uploadData = await uploadRes.json();

    // 返回公开访问的 URL
    res.json({ public_url: uploadData.secure_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器启动，监听端口 ${PORT}`);
});