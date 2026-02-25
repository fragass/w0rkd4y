import crypto from "crypto";

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Método não permitido" });
  }

  const { username, password } = req.body;

  const usersEnv = process.env.LOGIN_USERS || "";
  const usersArray = usersEnv.split(",");

  const usersMap = {};
  usersArray.forEach(pair => {
    const [user, pass] = pair.split(":");
    if (user && pass) usersMap[user] = pass;
  });

  if (usersMap[username] && usersMap[username] === password) {
    const token = crypto.randomBytes(32).toString("hex");

    return res.status(200).json({
      success: true,
      token,
      user: username
    });
  }

  return res.status(401).json({ success: false });
}
