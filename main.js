import fs from "fs";
import xml2js from "xml2js";
import { Pool } from "pg";
import express from "express";
import dotenv from "dotenv";
import multer from "multer";

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

const app = express();
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const stripNS = xml2js.processors.stripPrefix;

async function importarImoveis(xmlPath) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query("TRUNCATE TABLE imoveis RESTART IDENTITY");

    const xml = fs.readFileSync(xmlPath, "utf8");

    const parser = new xml2js.Parser({
      explicitArray: false,
      tagNameProcessors: [stripNS],
      mergeAttrs: true,
    });

    const json = await parser.parseStringPromise(xml);
    const listings = json.ListingDataFeed.Listings.Listing;

    const values = [];
    const placeholders = [];

    listings.forEach((item, index) => {
      const details = item.Details || {};

      const descricao = item.Title || null;
      const tipoOriginal = details.PropertyType || null;

      let tipo = null;
      switch (tipoOriginal) {
        case "Residential / Apartment":
          tipo = "Apartamento";
          break;
        case "Residential / Home":
          tipo = "Casa";
          break;
        case "Residential / Land Lot":
          tipo = "Terreno";
          break;
        case "Residential / Farm Ranch":
          tipo = "Chácara";
          break;
        case "Commercial / Office":
          tipo = "Sala Comercial";
          break;
        case "Commercial / Studio":
          tipo = "Studio";
          break;
        case "Commercial / Agricultural":
          tipo = "Área Agrícola";
          break;
        case "Commercial / Industrial":
          tipo = "Galpão Industrial";
          break;
        case "Commercial / Edificio Comercial":
          tipo = "Edifício Comercial";
          break;
        default:
          tipo = tipoOriginal;
      }

      console.log(item);

      const finalidade =
        item.TransactionType === "For Sale"
          ? "Venda"
          : item.TransactionType === "For Rent"
            ? "Aluguel"
            : item.TransactionType;

      const qtd_quartos = Number(details.Bedrooms) || 0;
      const qtd_banheiros = Number(details.Bathrooms) || 0;
      let qtd_vagas = Number(details.Garage?._) || Number(details.Garage) || 0;
      if (descricao && qtd_vagas === 0) {
        const vagasMatch = descricao.match(
          /(\d+)\s*vaga[s]?\s*(de\s*)?garagem/i,
        );
        if (vagasMatch) {
          qtd_vagas = Number(vagasMatch[1]) || 0;
        }
      }

      let preco = 0;
      const listPrice = details.ListPrice;
      const rentalPrice = details.RentalPrice;

      const bairro = item.Location?.Neighborhood || null;
      const cidade = item.Location?.City || null;

      if (listPrice) {
        preco =
          typeof listPrice === "object"
            ? parseFloat(listPrice._) || 0
            : parseFloat(listPrice) || 0;
      } else if (rentalPrice) {
        preco =
          typeof rentalPrice === "object"
            ? parseFloat(rentalPrice._) || 0
            : parseFloat(rentalPrice) || 0;
      }

      const ref = item.ListingID;
      const livingArea =
        Number(details.LivingArea?._) || Number(details.LivingArea) || 0;
      const lotArea =
        Number(details.LotArea?._) || Number(details.LotArea) || 0;
      const area_imovel = livingArea > 0 ? livingArea : lotArea;

      const link = item.DetailViewUrl 
        ? item.DetailViewUrl.replace(/\+/g, '-') 
        : null;

      const baseIndex = index * 12;

      placeholders.push(
        `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4},
    $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10}, $${baseIndex + 11}, $${baseIndex + 12} )`,
      );

      values.push(
        descricao,
        tipo.toUpperCase(),
        finalidade.toUpperCase(),
        qtd_quartos,
        qtd_banheiros,
        qtd_vagas,
        preco,
        area_imovel,
        link,
        bairro.toUpperCase(),
        cidade.toUpperCase(),
        ref,
      );
    });

    if (values.length) {
      await client.query(
        `
        INSERT INTO imoveis (
          descricao,
          tipo,
          finalidade,
          qtd_quartos,
          qtd_banheiros,
          qtd_vagas,
          preco,
          area_imovel,
          link,
          bairro,
          cidade,
          ref
        ) VALUES ${placeholders.join(",")}
        `,
        values,
      );
    }

    await client.query("COMMIT");
    console.log(`✅ ${listings.length} imóveis importados`);
    return { success: true, count: listings.length };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erro na importação:", error);
    throw error;
  } finally {
    client.release();
  }
}

app.post("/importar-xml", upload.single("xmlFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const result = await importarImoveis(req.file.path);

    fs.unlinkSync(req.file.path);

    res.json({
      message: "Importação concluída com sucesso",
      imoveisImportados: result.count,
    });
  } catch (error) {
    res.status(500).json({
      error: "Erro ao importar imóveis",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
