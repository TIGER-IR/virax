const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

io.on("connection", (socket) => {

    console.log(
        "User connected:",
        socket.id
    );

    socket.on("join", (phone) => {

        socket.phone = phone;

        socket.join("virax");

        console.log(
            "Joined:",
            phone
        );
    });

    socket.on(
        "send_message",
        (data) => {

            if (
                !data ||
                !data.phone ||
                !data.message
            ) {
                return;
            }

            const message = {
                phone: data.phone,
                message: String(
                    data.message
                ),
                time: Date.now()
            };

            io.to("virax").emit(
                "new_message",
                message
            );
        }
    );

    socket.on(
        "disconnect",
        () => {

            console.log(
                "User disconnected:",
                socket.id
            );

        }
    );

});

app.get(
    "/health",
    (req, res) => {

        res.json({
            status: "ok",
            app: "Virax"
        });

    }
);

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Virax server running on port ${PORT}`
        );

    }
);
