export interface CustomUserStyle {
  name: string;
  picture?: string;
  security: "free" | "general";
}

export interface CustomTopicUserStyles {
  [email: string]: CustomUserStyle;
}

export const users: CustomTopicUserStyles = {
  "choonglee1219@kepco-enc.com": {
    name: "Lee, Choonghyun",
    picture: "/profiles/john.jpg",
    security: "free",
  },
  "cwy@kepco-enc.com": {
    name: "Ye, Changwoo",
    picture: "/profiles/user_a.jpg",
    security: "general",
  },
  "shinjs@kepco-enc.com": {
    name: "Shin, Jae Seop",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
  "55498@kepco-enc.com": {
    name: "Park, Jae Young",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
  "ko66933@kepco-enc.com": {
    name: "Jung, Sung Young",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
  "kimgaeul@kepco-enc.com": {
    name: "Kim, Ga Eul",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
  "fiancee@kepco-enc.com": {
    name: "Kim, Seo Woo",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
  "ko68428@kepco-enc.com": {
    name: "Kim, Eun Ah",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
  "hjshkhj@kepco-enc.com": {
    name: "Kim, Chan Ho",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
  "youjinim@kepco-enc.com": {
    name: "Im, You Jin",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
  "juhyang@kepco-enc.com": {
    name: "Choi, Ju Hyang",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
  "ko68856@kepco-enc.com": {
    name: "Hong, Ki Hwa",
    picture: "/profiles/user_b.jpg",
    security: "general",
  },
};
