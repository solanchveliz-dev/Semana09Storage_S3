# 🎬 VlogVault Studio — Lab 09 Cloud Storage (Amazon S3)

Aplicación web para **subir, listar, previsualizar y eliminar fotos y videos** en un bucket **privado** de Amazon S3, usando **URLs prefirmadas (presigned URLs)**. El navegador **nunca** recibe credenciales de AWS.

**Curso:** Desarrollo de Soluciones en la Nube · **Docente:** Jaime Farfán · **Alumna:** Naomi Veliz · Tecsup 2026

---

## 🏗️ Arquitectura

```
Navegador ──(1) POST /api/upload-url──▶ Backend (Express + AWS SDK v3)
    ▲                                        │
    └──────(2) presigned URL (5 min)─────────┘
    │
    └──(3) PUT archivo directo ──▶ Amazon S3 (bucket privado, SSE-S3, HTTPS obligatorio)
```

El archivo viaja **directo del navegador a S3**, no pasa por el backend. El backend solo firma URLs de corta duración con un usuario IAM de **mínimo privilegio**.

## 🧰 Stack

- **Backend:** Node.js 18+, Express 4, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, dotenv, cors
- **Frontend:** HTML + CSS + JavaScript vanilla (drag & drop, barra de progreso, galería con filtros, reproductor de video)
- **AWS:** S3 (us-east-2), IAM

## 📁 Estructura

```
Semana09Storage_S3/
├── .gitignore
├── README.md
├── backend/
│   ├── .env            
│   ├── package.json
│   └── server.js
└── frontend/
    ├── index.html
    ├── app.js
    └── styles.css
```

## 🚀 Instalación y ejecución

```bash
cd backend
npm install
```

Crear `backend/.env`:

```env
AWS_REGION=us-east-2
S3_BUCKET=lab-09-veliz-20261014
AWS_ACCESS_KEY_ID=TU_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=TU_SECRET_KEY
PORT=3000
```

Ejecutar:

```bash
node server.js
```

Abrir **http://localhost:3000**. El backend también sirve el frontend.

## 🔌 Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/upload-url` | Recibe `filename`, `contentType`, `sizeBytes`. Valida y devuelve una presigned URL **PUT válida por 5 min** |
| `GET` | `/api/images` | Lista los archivos de `originales/` con presigned URLs **GET válidas por 15 min** |
| `DELETE` | `/api/images/:key` | Elimina el archivo indicado (con versionado activo, genera un *delete marker*) |

## ✅ Validaciones

| Tipo | Formatos | Tamaño máximo |
|---|---|---|
| Fotos | `image/jpeg`, `image/png`, `image/webp` | 5 MB |
| Videos (extra) | `video/mp4`, `video/webm`, `video/quicktime` | 50 MB |

Se valida **en el frontend y otra vez en el backend**. El nombre del archivo se sanitiza (bloquea `../` y caracteres especiales) y se le agrega un timestamp y un hash aleatorio para evitar colisiones.

## ☁️ Configuración en AWS

- **Bucket:** `lab-09-veliz-20261014` (us-east-2), con *Block all public access* activado
- **Carpetas:** `originales/`, `miniaturas/`, `temporal/`
- **Cifrado en reposo:** SSE-S3 (AES-256), con SSE-C bloqueado
- **Versionado:** habilitado
- **Ciclo de vida:** `regla-imagenes-antiguas` sobre `originales/`
- **Usuario IAM:** `app-imagenes-user`, sin acceso a consola, solo con `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` y `s3:ListBucket` sobre el bucket
- **Política de bucket:** niega cualquier conexión sin HTTPS (`aws:SecureTransport = false`)
- **CORS:** permite `PUT` y `GET` solo desde `http://localhost:3000` y `http://localhost:8080`

## 🔐 Seguridad

- Las credenciales viven solo en `backend/.env`, que está en `.gitignore`. El frontend no tiene claves.
- Las presigned URLs son de corta duración (5 min para subir, 15 min para ver).
- El bucket es 100% privado; los objetos solo se ven con URL firmada.
- Se aplica mínimo privilegio en IAM: el usuario no puede borrar el bucket ni cambiar políticas.
- Cifrado en tránsito (HTTPS forzado) y en reposo (SSE-S3).
- La validación del backend no depende del navegador.

## 🧪 Pruebas realizadas

1. Subir un JPG válido: aparece en la galería ✅
2. Subir un `.pdf` o `.exe`: el frontend lo bloquea ✅
3. Pedir URL para 10 MB: el backend responde `Archivo demasiado grande (máx 5 MB)` ✅
4. Abrir una URL de visualización después de 16 min: `Request has expired` ✅
5. Inspeccionar el código del frontend: no hay credenciales ✅
6. Pestaña Network: el `PUT` va directo a `*.s3.us-east-2.amazonaws.com` ✅

## 🌟 Mejoras futuras (retos opcionales)

- [ ] Miniaturas automáticas con **AWS Lambda** activada por evento S3 (salida en `miniaturas/`)
- [ ] Autenticación con **Amazon Cognito** (cada usuario en `originales/<userId>/`)
- [ ] Frontend en **S3 estático + CloudFront** con HTTPS
- [ ] **S3 Object Tags** para clasificar por proyecto o cliente
- [ ] Rate limiting en `/api/upload-url` y validación por *magic bytes*

## 🧹 Limpieza de recursos

Al terminar: vaciar el bucket (incluidas las versiones), eliminarlo, eliminar las access keys y el usuario `app-imagenes-user`.