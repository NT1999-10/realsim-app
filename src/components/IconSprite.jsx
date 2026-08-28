import React from "react";
import yomuSprite from "../assets/yomu-sprite.svg?raw";

export default function IconSprite() {
  return (
    <div
      style={{ display: "contents" }}
      dangerouslySetInnerHTML={{ __html: yomuSprite }}
    />
  );
}
