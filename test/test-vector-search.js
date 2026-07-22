require("dotenv").config();
const { Pool } = require("pg");
const axios = require("axios");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function getEmbedding(text) {
  const res = await axios.post(
    `${process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010"}/api/v1/embedding/embed`,
    {
      texts: [text],
      model: "aliyun-v4",
      normalize: true,
      batch_size: 1,
    }
  );
  return res.data.embeddings[0];
}

async function searchSimilar(text, topN = 5) {
  const embedding = await getEmbedding(text);
  const client = await pool.connect();
  try {
    const sql = `
      SELECT s.id, s.segment_index, s.segment_text, f.originalname, s.status,
        s.embedding_vector <#> $1::vector AS distance
      FROM knowledge_segments s
      JOIN knowledge_files f ON s.file_id = f.id
      WHERE s.embedding_vector IS NOT NULL
      ORDER BY s.embedding_vector <#> $1::vector
      LIMIT $2
    `;
    const vectorStr = "[" + embedding.join(",") + "]";
    const result = await client.query(sql, [vectorStr, topN]);
    return result.rows;
  } finally {
    client.release();
  }
}

(async () => {
  const queryText = "打印机及复印件申领报废";
  const results = await searchSimilar(queryText, 5);
  console.log("Top 5 similar segments:");
  console.table(results);
  process.exit(0);
})();
