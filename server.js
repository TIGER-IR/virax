const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

/*
|--------------------------------------------------------------------------
| In-memory database
|--------------------------------------------------------------------------
| فعلاً دیتابیس نداریم.
| اطلاعات تا زمانی که سرور ری‌استارت نشده در RAM می‌مانند.
|--------------------------------------------------------------------------
*/

const users = new Map();
const sockets = new Map();
const messages = new Map();

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function cleanPhone(value) {
    return String(value || "").replace(/\D/g, "");
}

function cleanUsername(value) {
    return String(value || "")
        .trim()
        .replace(/^@/, "")
        .replace(/\s+/g, "_")
        .toLowerCase();
}

function validPhone(phone) {
    return /^09\d{9}$/.test(phone);
}

function validUsername(username) {
    return /^[a-zA-Z0-9_]{3,24}$/.test(username);
}

function makeId() {
    return crypto.randomUUID();
}

function conversationKey(a, b) {
    return [a, b].sort().join(":");
}

function publicUser(user) {
    if (!user) return null;

    return {
        id: user.id,
        phone: user.phone,
        name: user.name,
        username: user.username,
        photo: user.photo || "",
        online: sockets.has(user.phone)
    };
}

function sendError(socket, message) {
    socket.emit("error_message", {
        message
    });
}

/*
|--------------------------------------------------------------------------
| Express
|--------------------------------------------------------------------------
*/

app.use(express.json());

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        app: "Virax",
        users: users.size,
        conversations: messages.size
    });
});

/*
|--------------------------------------------------------------------------
| Register / Login
|--------------------------------------------------------------------------
*/

io.on("connection", (socket) => {

    console.log("CONNECTED:", socket.id);

    /*
    |--------------------------------------------------------------------------
    | Login
    |--------------------------------------------------------------------------
    */

    socket.on("login", ({ phone }) => {

        phone = cleanPhone(phone);

        if (!validPhone(phone)) {
            return sendError(
                socket,
                "شماره موبایل معتبر نیست"
            );
        }

        let user = users.get(phone);

        if (!user) {

            user = {
                id: makeId(),
                phone,
                name: "کاربر Virax",
                username: "",
                photo: "",
                createdAt: Date.now()
            };

            users.set(phone, user);
        }

        sockets.set(phone, socket.id);

        socket.phone = phone;

        socket.join(`user:${phone}`);

        socket.emit("login_success", {
            user: publicUser(user)
        });

        io.emit("presence", {
            phone,
            online: true
        });

        console.log("LOGIN:", phone);
    });

    /*
    |--------------------------------------------------------------------------
    | Update Profile
    |--------------------------------------------------------------------------
    */

    socket.on("update_profile", (data) => {

        if (!socket.phone) {
            return;
        }

        const user = users.get(socket.phone);

        if (!user) {
            return;
        }

        const name =
            String(data?.name || "")
                .trim()
                .slice(0, 40);

        const username =
            cleanUsername(data?.username);

        if (!name) {
            return sendError(
                socket,
                "نام را وارد کنید"
            );
        }

        if (!validUsername(username)) {
            return sendError(
                socket,
                "نام کاربری باید ۳ تا ۲۴ کاراکتر باشد"
            );
        }

        for (const item of users.values()) {

            if (
                item.phone !== socket.phone &&
                item.username === username
            ) {
                return sendError(
                    socket,
                    "این نام کاربری قبلاً استفاده شده است"
                );
            }
        }

        user.name = name;
        user.username = username;

        if (typeof data.photo === "string") {
            user.photo =
                data.photo.slice(0, 2_000_000);
        }

        users.set(socket.phone, user);

        socket.emit("profile_updated", {
            user: publicUser(user)
        });

        /*
        | اطلاع به کسانی که این کاربر را دارند
        */

        io.emit("user_updated", {
            user: publicUser(user)
        });
    });

    /*
    |--------------------------------------------------------------------------
    | Search Users
    |--------------------------------------------------------------------------
    */

    socket.on("search_users", (query) => {

        const q = String(query || "")
            .trim()
            .replace(/^@/, "")
            .toLowerCase();

        if (!q) {
            return socket.emit(
                "search_results",
                []
            );
        }

        const result = [];

        for (const user of users.values()) {

            const match =
                user.username
                    .toLowerCase()
                    .includes(q) ||
                user.name
                    .toLowerCase()
                    .includes(q);

            if (match) {
                result.push(
                    publicUser(user)
                );
            }

            if (result.length >= 30) {
                break;
            }
        }

        socket.emit(
            "search_results",
            result
        );
    });

    /*
    |--------------------------------------------------------------------------
    | Get User By Username
    |--------------------------------------------------------------------------
    */

    socket.on("get_user", (username) => {

        const q = cleanUsername(username);

        const user =
            [...users.values()]
                .find(
                    x =>
                        x.username === q
                );

        socket.emit(
            "user_result",
            user
                ? publicUser(user)
                : null
        );
    });

    /*
    |--------------------------------------------------------------------------
    | Open Private Chat
    |--------------------------------------------------------------------------
    */

    socket.on("open_chat", ({ phone }) => {

        if (!socket.phone) {
            return;
        }

        phone = cleanPhone(phone);

        if (!users.has(phone)) {
            return sendError(
                socket,
                "کاربر پیدا نشد"
            );
        }

        const key =
            conversationKey(
                socket.phone,
                phone
            );

        const history =
            messages.get(key) || [];

        socket.emit("chat_history", {
            phone,
            messages: history
        });
    });

    /*
    |--------------------------------------------------------------------------
    | Send Private Message
    |--------------------------------------------------------------------------
    */

    socket.on("send_message", (data) => {

        if (!socket.phone) {
            return;
        }

        const to =
            cleanPhone(data?.to);

        const text =
            String(data?.message || "")
                .trim()
                .slice(0, 4000);

        if (!validPhone(to)) {
            return sendError(
                socket,
                "گیرنده معتبر نیست"
            );
        }

        if (!text) {
            return;
        }

        if (!users.has(to)) {
            return sendError(
                socket,
                "این کاربر وجود ندارد"
            );
        }

        const message = {
            id: makeId(),
            from: socket.phone,
            to,
            message: text,
            time: Date.now()
        };

        const key =
            conversationKey(
                socket.phone,
                to
            );

        if (!messages.has(key)) {
            messages.set(key, []);
        }

        const history =
            messages.get(key);

        history.push(message);

        /*
        | محدود کردن حافظه
        */

        if (history.length > 500) {
            history.splice(
                0,
                history.length - 500
            );
        }

        /*
        | فرستنده
        */

        socket.emit(
            "new_message",
            message
        );

        /*
        | گیرنده
        */

        io.to(`user:${to}`).emit(
            "new_message",
            message
        );
    });

    /*
    |--------------------------------------------------------------------------
    | Typing
    |--------------------------------------------------------------------------
    */

    socket.on("typing", ({ to, typing }) => {

        if (!socket.phone) {
            return;
        }

        to = cleanPhone(to);

        io.to(`user:${to}`).emit(
            "typing",
            {
                from: socket.phone,
                typing: !!typing
            }
        );
    });

    /*
    |--------------------------------------------------------------------------
    | Disconnect
    |--------------------------------------------------------------------------
    */

    socket.on("disconnect", () => {

        if (!socket.phone) {
            return;
        }

        /*
        | فقط اگر همین Socket هنوز فعال است
        */

        if (
            sockets.get(socket.phone) ===
            socket.id
        ) {
            sockets.delete(socket.phone);

            io.emit("presence", {
                phone: socket.phone,
                online: false
            });
        }

        console.log(
            "DISCONNECTED:",
            socket.phone
        );
    });
});

/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `Virax running on port ${PORT}`
        );
    }
);
