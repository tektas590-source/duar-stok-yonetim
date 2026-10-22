import React, { useEffect, useState } from "react";

const e = React.createElement;

// Giriş ekranındaki sinematik anlatım: kaydırdıkça dişli sahnesi değişir.
export function LoginStory() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);

  return e(React.Fragment, null,
    e("header", { className: "story-top" },
      e("span", null, e("b", null, "Demir"), " Eurorepar Car Service"),
      e("span", { className: "story-progress", "aria-hidden": "true" }, e("i", { style: { width: `${(progress * 100).toFixed(1)}%` } }))),
    e("div", { className: "story-hero" },
      e("p", { className: "story-tag" }, "Servis · Yedek Parça · Bakım"),
      e("h2", { className: "story-title story-title-xl" }, "Her dişli ", e("em", null, "yerine"), " oturur."),
      e("p", null, "Doğru parça, doğru ölçü, doğru montaj. Aracınızın içindeki mekanik düzeni parça parça biliyoruz."),
      e("div", { className: "story-scroll" }, "Aşağı kaydırın")),
    e("section", { className: "story-section story-right" },
      e("div", { className: "story-copy" },
        e("p", { className: "story-tag" }, "Aktarma organları"),
        e("h2", { className: "story-title" }, "Üç dişli, tek hareket."),
        e("p", null, "Küçük dişli hızı artırır, büyük dişli torku taşır. Birinin bile diş aralığı bozulsa tüm sistem ses çıkarır."),
        e("dl", { className: "story-spec" },
          e("dt", null, "Dişli oranı"), e("dd", null, "20 : 12 : 30"),
          e("dt", null, "Modül"), e("dd", null, "1,0 mm"),
          e("dt", null, "Malzeme"), e("dd", null, "Sertleştirilmiş çelik")))),
    e("section", { className: "story-section" },
      e("div", { className: "story-copy" },
        e("p", { className: "story-tag" }, "Krank · Biyel · Piston"),
        e("h2", { className: "story-title" }, "Dönüş, düz harekete dönüşür."),
        e("p", null, "Krank mili döner, biyel kolu pistonu iter. Motorun her devri bu üç parçanın hizasına bağlıdır."))),
    e("section", { className: "story-section story-right" },
      e("div", { className: "story-copy" },
        e("p", { className: "story-tag" }, "Servisimizde"),
        e("h2", { className: "story-title" }, "Açıp bakarız."),
        e("p", null, "Parçayı değiştirmeden önce nedenini buluruz. Kullanılan her parça kayıt altına alınır."),
        e("ul", { className: "story-list" },
          [["Periyodik bakım", "YAĞ · FİLTRE"], ["Fren sistemi", "BALATA · DİSK"], ["Motor ve şanzıman", "ARIZA TESPİT"], ["Yedek parça", "STOKTAN TESLİM"]]
            .map(([name, tag]) => e("li", { key: name }, name, e("span", null, tag)))))),
    e("footer", { className: "story-footer" }, "Demir Eurorepar Car Service"));
}
