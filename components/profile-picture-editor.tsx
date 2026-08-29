"use client";

import { ChangeEvent, useEffect, useState } from "react";
import Image from "next/image";

const AVATAR_KEY = "torres-profile-avatar";
const AVATAR_EVENT = "torres-profile-avatar-changed";

export function readProfileAvatar() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AVATAR_KEY) ?? "";
}

export function ProfilePictureEditor() {
  const [avatar, setAvatar] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => setAvatar(readProfileAvatar()), []);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setNotice("Choose an image file."); return; }
    if (file.size > 2 * 1024 * 1024) { setNotice("Choose an image smaller than 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      window.localStorage.setItem(AVATAR_KEY, value);
      window.dispatchEvent(new Event(AVATAR_EVENT));
      setAvatar(value);
      setNotice("Profile picture updated.");
    };
    reader.readAsDataURL(file);
  }

  function remove() {
    window.localStorage.removeItem(AVATAR_KEY);
    window.dispatchEvent(new Event(AVATAR_EVENT));
    setAvatar("");
    setNotice("Profile picture removed.");
  }

  return <section className="detail-card profile-picture-card">
    <div className="profile-picture-preview">{avatar ? <Image src={avatar} alt="Profile preview" width={78} height={78} unoptimized /> : <span>JT</span>}</div>
    <div className="profile-picture-copy"><p className="eyebrow">Account identity</p><h2>Profile picture</h2><p>Choose a square JPG, PNG, or WebP image up to 2 MB. This picture appears in your workspace header.</p><div className="form-actions"><label className="button button-dark profile-upload">Edit Profile Picture<input type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} /></label>{avatar && <button className="button button-outline" type="button" onClick={remove}>Remove</button>}</div>{notice && <small className="form-message" role="status">{notice}</small>}</div>
  </section>;
}
