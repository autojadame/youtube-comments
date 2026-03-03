module.exports = {
    apps: [
        {
            name: "youtube-comments",
            cwd: "/home/admin/youtube-comments",
            script: "yarn",
            args: "dev",
            env: {
                NODE_ENV: "production",
                PORT: "3777",
                BASE_URL: "https://youtube.safeblocklab.com",
                DEEPSEEK_API_KEY: "sk-490308a1f86f4ee8a82c8f5ad858a52a",
            },
            autorestart: true,
            max_restarts: 10,
            time: true,
        },
        {
            name: "youtube-comments-worker",
            cwd: "/home/admin/youtube-comments",
            script: "yarn",
            args: "worker",
            env: {
                NODE_ENV: "production",
                BASE_URL: "https://youtube.safeblocklab.com",
                DB_PATH: "/home/admin/youtube-comments/data.sqlite",
                DEEPSEEK_API_KEY: "sk-490308a1f86f4ee8a82c8f5ad858a52a"
            },
            autorestart: true,
            time: true,
        },
    ],
};