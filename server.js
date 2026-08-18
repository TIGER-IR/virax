const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

/* =========================
   Middleware
========================= */

app.use(express.json({ limit: "5mb" }));

app.use(express.static(
    path.join(__dirname, "public")
));


/* =========================
   In-Memory Database
   فعلاً بدون دیتابیس
========================= */

const users = new Map();
const messages = new Map();
const onlineUsers = new Map();
const admins = new Set();

const MAIN_ADMIN = "09001115958";

admins.add(MAIN_ADMIN);


/* =========================
   Helpers
========================= */

function cleanPhone(phone) {
    return String(phone || "")
        .replace(/\D/g, "");
}

function cleanUsername(username) {
    return String(username || "")
        .trim()
        .replace(/^@/, "")
        .toLowerCase();
}

function validPhone(phone) {
    return /^09\d{9}$/.test(phone);
}

function getUser(phone) {
    phone = cleanPhone(phone);

    return users.get(phone) || {
        phone,
        name: "کاربر Virax",
        username: "",
        photo: "",
        verified: false,
        createdAt: Date.now()
    };
}

function publicUser(user) {
    return {
        phone: user.phone,
        name: user.name,
        username: user.username,
        photo: user.photo,
        verified: user.verified
    };
}

function roomKey(a, b) {
    return [a, b]
        .sort()
        .join(":");
}

function getRoomMessages(a, b) {
    const key = roomKey(a, b);

    if (!messages.has(key)) {
        messages.set(key, []);
    }

    return messages.get(key);
}


/* =========================
   Create / Update User
========================= */

function createUser(phone) {
    phone = cleanPhone(phone);

    if (!validPhone(phone)) {
        return null;
    }

    if (!users.has(phone)) {
        users.set(phone, {
            phone,
            name: "کاربر Virax",
            username: "",
            photo: "",
            verified: false,
            createdAt: Date.now()
        });
    }

    return users.get(phone);
}


/* =========================
   Health
========================= */

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        app: "Virax",
        online: onlineUsers.size,
        users: users.size,
        uptime: Math.floor(process.uptime())
    });
});


/* =========================
   API - Register / Login
========================= */

app.post("/api/login", (req, res) => {
    const phone = cleanPhone(req.body.phone);

    if (!validPhone(phone)) {
        return res.status(400).json({
            ok: false,
            error: "شماره موبایل معتبر نیست"
        });
    }

    const user = createUser(phone);

    res.json({
        ok: true,
        user: publicUser(user)
    });
});


/* =========================
   API - Search Users
========================= */

app.get("/api/users/search", (req, res) => {
    const q = String(req.query.q || "")
        .trim()
        .toLowerCase()
        .replace(/^@/, "");

    if (!q) {
        return res.json({
            ok: true,
            users: []
        });
    }

    const result = [];

    for (const user of users.values()) {

        const phoneMatch =
            user.phone.includes(q);

        const usernameMatch =
            user.username &&
            user.username.toLowerCase().includes(q);

        const nameMatch =
            user.name &&
            user.name.toLowerCase().includes(q);

        if (
            phoneMatch ||
            usernameMatch ||
            nameMatch
        ) {
            result.push(
                publicUser(user)
            );
        }

        if (result.length >= 30) {
            break;
        }
    }

    res.json({
        ok: true,
        users: result
    });
});


/* =========================
   API - User Profile
========================= */

app.get("/api/users/:phone", (req, res) => {
    const phone = cleanPhone(
        req.params.phone
    );

    const user = users.get(phone);

    if (!user) {
        return res.status(404).json({
            ok: false,
            error: "کاربر پیدا نشد"
        });
    }

    res.json({
        ok: true,
        user: publicUser(user)
    });
});


/* =========================
   API - Update Profile
========================= */

app.post("/api/profile", (req, res) => {

    const phone = cleanPhone(
        req.body.phone
    );

    if (!validPhone(phone)) {
        return res.status(400).json({
            ok: false,
            error: "شماره معتبر نیست"
        });
    }

    const user = createUser(phone);

    const name =
        String(req.body.name || "")
            .trim()
            .slice(0, 50);

    const username =
        cleanUsername(
            req.body.username
        ).slice(0, 30);

    if (username) {

        for (const u of users.values()) {

            if (
                u.phone !== phone &&
                u.username === username
            ) {
                return res.status(409).json({
                    ok: false,
                    error: "این نام کاربری قبلاً استفاده شده است"
                });
            }
        }
    }

    user.name =
        name || "کاربر Virax";

    user.username = username;

    if (
        typeof req.body.photo === "string" &&
        req.body.photo.length < 4_000_000
    ) {
        user.photo = req.body.photo;
    }

    users.set(phone, user);

    io.emit("user_updated", publicUser(user));

    res.json({
        ok: true,
        user: publicUser(user)
    });
});


/* =========================
   Socket.IO
========================= */

io.on("connection", (socket) => {

    console.log(
        "Socket connected:",
        socket.id
    );


    /* =========================
       Join
    ========================= */

    socket.on("join", (phone, callback) => {

        phone = cleanPhone(phone);

        if (!validPhone(phone)) {

            if (typeof callback === "function") {
                callback({
                    ok: false,
                    error: "شماره موبایل معتبر نیست"
                });
            }

            return;
        }

        const user = createUser(phone);

        socket.phone = phone;

        socket.join(`user:${phone}`);

        onlineUsers.set(phone, socket.id);

        socket.broadcast.emit(
            "user_online",
            {
                phone
            }
        );

        socket.emit(
            "online_users",
            Array.from(onlineUsers.keys())
        );

        if (typeof callback === "function") {
            callback({
                ok: true,
                user: publicUser(user)
            });
        }

        console.log(
            "User joined:",
            phone
        );
    });


    /* =========================
       Search
    ========================= */

    socket.on("search_users", (query, callback) => {

        const q = String(query || "")
            .trim()
            .toLowerCase()
            .replace(/^@/, "");

        const result = [];

        if (q) {

            for (const user of users.values()) {

                if (
                    user.phone.includes(q) ||
                    user.username
                        .toLowerCase()
                        .includes(q) ||
                    user.name
                        .toLowerCase()
                        .includes(q)
                ) {
                    result.push(
                        publicUser(user)
                    );
                }

                if (result.length >= 30) {
                    break;
                }
            }
        }

        if (typeof callback === "function") {
            callback({
                ok: true,
                users: result
            });
        }
    });


    /* =========================
       Open Chat
    ========================= */

    socket.on("get_messages", (target, callback) => {

        if (!socket.phone) {
            return;
        }

        const targetPhone =
            cleanPhone(target);

        if (!validPhone(targetPhone)) {
            return;
        }

        const data =
            getRoomMessages(
                socket.phone,
                targetPhone
            );

        if (typeof callback === "function") {
            callback({
                ok: true,
                messages: data
            });
        }
    });


    /* =========================
       Send Message
    ========================= */

    socket.on("send_message", (data, callback) => {

        if (!socket.phone) {

            if (typeof callback === "function") {
                callback({
                    ok: false,
                    error: "ابتدا وارد حساب شوید"
                });
            }

            return;
        }

        const target =
            cleanPhone(data?.to);

        const text =
            String(data?.message || "")
                .trim()
                .slice(0, 4000);

        if (!validPhone(target)) {

            if (typeof callback === "function") {
                callback({
                    ok: false,
                    error: "کاربر مقصد معتبر نیست"
                });
            }

            return;
        }

        if (!text) {

            if (typeof callback === "function") {
                callback({
                    ok: false,
                    error: "پیام خالی است"
                });
            }

            return;
        }

        createUser(target);

        const message = {
            id:
                `${Date.now()}_${Math.random()
                    .toString(36)
                    .slice(2, 10)}`,

            from: socket.phone,

            to: target,

            message: text,

            time: Date.now()
        };

        const room =
            getRoomMessages(
                socket.phone,
                target
            );

        room.push(message);

        /* جلوگیری از رشد بی‌نهایت حافظه */

        if (room.length > 1000) {
            room.splice(
                0,
                room.length - 1000
            );
        }

        /* ارسال به فرستنده */

        socket.emit(
            "new_message",
            message
        );

        /* ارسال به گیرنده */

        io.to(`user:${target}`).emit(
            "new_message",
            message
        );

        if (typeof callback === "function") {
            callback({
                ok: true,
                message
            });
        }
    });


    /* =========================
       Typing
    ========================= */

    socket.on("typing", (target) => {

        if (!socket.phone) {
            return;
        }

        const targetPhone =
            cleanPhone(target);

        if (!validPhone(targetPhone)) {
            return;
        }

        io.to(`user:${targetPhone}`).emit(
            "typing",
            {
                from: socket.phone
            }
        );
    });


    socket.on("stop_typing", (target) => {

        if (!socket.phone) {
            return;
        }

        const targetPhone =
            cleanPhone(target);

        io.to(`user:${targetPhone}`).emit(
            "stop_typing",
            {
                from: socket.phone
            }
        );
    });


    /* =========================
       Delete Message
    ========================= */

    socket.on(
        "delete_message",
        (data, callback) => {

            if (!socket.phone) {
                return;
            }

            const messageId =
                String(data?.id || "");

            const target =
                cleanPhone(data?.to);

            const room =
                getRoomMessages(
                    socket.phone,
                    target
                );

            const index =
                room.findIndex(
                    x => x.id === messageId
                );

            if (index === -1) {

                if (typeof callback === "function") {
                    callback({
                        ok: false,
                        error: "پیام پیدا نشد"
                    });
                }

                return;
            }

            if (
                room[index].from !==
                socket.phone
            ) {

                if (typeof callback === "function") {
                    callback({
                        ok: false,
                        error: "اجازه حذف این پیام را ندارید"
                    });
                }

                return;
            }

            room.splice(index, 1);

            io.to(`user:${target}`).emit(
                "message_deleted",
                {
                    id: messageId
                }
            );

            socket.emit(
                "message_deleted",
                {
                    id: messageId
                }
            );

            if (typeof callback === "function") {
                callback({
                    ok: true
                });
            }
        }
    );


    /* =========================
       Admin
    ========================= */

    socket.on("admin_action", (data, callback) => {

        if (!socket.phone) {
            return;
        }

        if (
            socket.phone !== MAIN_ADMIN &&
            !admins.has(socket.phone)
        ) {

            if (typeof callback === "function") {
                callback({
                    ok: false,
                    error: "دسترسی ندارید"
                });
            }

            return;
        }

        const action =
            String(data?.action || "");

        const target =
            cleanPhone(data?.phone);

        if (!validPhone(target)) {
            return;
        }

        if (action === "add_admin") {

            if (socket.phone !== MAIN_ADMIN) {
                return;
            }

            admins.add(target);
        }

        if (action === "remove_admin") {

            if (target !== MAIN_ADMIN) {
                admins.delete(target);
            }
        }

        if (action === "verify") {

            const user = users.get(target);

            if (user) {
                user.verified =
                    Boolean(data.value);

                users.set(target, user);

                io.emit(
                    "user_updated",
                    publicUser(user)
                );
            }
        }

        if (typeof callback === "function") {
            callback({
                ok: true
            });
        }
    });


    /* =========================
       Disconnect
    ========================= */

    socket.on("disconnect", () => {

        if (socket.phone) {

            const current =
                onlineUsers.get(
                    socket.phone
                );

            if (current === socket.id) {

                onlineUsers.delete(
                    socket.phone
                );

                socket.broadcast.emit(
                    "user_offline",
                    {
                        phone: socket.phone
                    }
                );
            }
        }

        console.log(
            "Socket disconnected:",
            socket.id
        );
    });

});


/* =========================
   Error Handler
========================= */

app.use((err, req, res, next) => {

    console.error(err);

    res.status(500).json({
        ok: false,
        error: "خطای داخلی سرور"
    });
});


/* =========================
   Start Server
========================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `⚡ Virax server running on port ${PORT}`
        );

        console.log(
            `🌐 Port: ${PORT}`
        );

        console.log(
            `👥 Main admin: ${MAIN_ADMIN}`
        );
    }
);
