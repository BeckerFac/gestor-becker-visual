-- Inicialización básica de la base de datos
-- Las tablas se crean automáticamente al iniciar la aplicación
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Mensaje de confirmación
SELECT 'Database initialized successfully' as status;
