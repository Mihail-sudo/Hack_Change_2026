import { createBrowserRouter } from "react-router-dom";
import { ChatPage } from "@/pages/chat";

export const routes = [
  {
    path: "/",
    element: <ChatPage />,
  },
];

export const router = createBrowserRouter(routes);
