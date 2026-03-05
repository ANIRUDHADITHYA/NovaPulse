module.exports = {
  apps: [
    {
      name: 'novapulse-backend',
      script: 'backend/server.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
      error_file: 'logs/backend-error.log',
      out_file: 'logs/backend-out.log',
    },
    {
      name: 'novapulse-ml',
      script: 'ml-service/app.py',
      interpreter: 'ml-service/.venv/bin/python3',
      env: {
        FLASK_ENV: 'production',
        ML_PORT: process.env.ML_PORT || '5001',
      },
      error_file: 'logs/ml-error.log',
      out_file: 'logs/ml-out.log',
    },
  ],
};
