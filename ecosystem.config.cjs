module.exports = {
    apps: [
        {
            name: "youtube-comments",
            cwd: "/home/admin/youtube-comments",
            script: "yarn",
            args: "start",
            env: {
                NODE_ENV: "production",
                PORT: "3777",
                // añade aquí lo que uses:
                // BASE_URL: "https://youtube.safeblocklab.com",
                // DEEPSEEK_API_KEY: "xxx",
            },
            autorestart: true,
            max_restarts: 10,
            time: true,
        },
    ],
};