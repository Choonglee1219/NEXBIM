export interface CustomUserStyle {
  name: string;
  picture?: string;
  security: "free" | "general";
}

export interface CustomTopicUserStyles {
  [email: string]: CustomUserStyle;
}

export const users: CustomTopicUserStyles = {
  "jhon.doe@example.com": {
    name: "John Doe",
    picture: "/profiles/john.jpg",
    security: "free",
  },
  "user_a@something.com": {
    name: "User A",
    picture: "/profiles/user_a.jpg",
    security: "general",
  },
  "user_b@something.com": {
    name: "User B",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
};