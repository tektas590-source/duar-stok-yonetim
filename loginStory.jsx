import React, { useEffect, useState } from "react";
import { useBusiness } from "./business.js";

const e = React.createElement;

// Giriş ekranındaki sinematik anlatım: kaydırdıkça bağlı sistem sahnesi değişir.
export function LoginStory() {
  const business = useBusiness();
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
      e("span", null, business.fullName),
      e("span", { className: "story-progress", "aria-hidden": "true" }, e("i", { style: { width: `${(progress * 100).toFixed(1)}%` } }))),
    e("div", { className: "story-hero" },
      e("p", { className: "story-tag" }, "Stok · İş Emri · Fatura"),
      e("h2", { className: "story-title story-title-xl" }, "Her işlem ", e("em", null, "yerinde"), " akar."),
      e("p", null, "Stoktan faturaya, iş emrinden raporlamaya — tüm servis süreciniz tek bir merkezde, gerçek zamanlı olarak birbirine bağlı."),
      e("div", { className: "story-scroll" }, "Aşağı kaydırın")),
    e("section", { className: "story-section story-right" },
      e("div", { className: "story-copy" },
        e("p", { className: "story-tag" }, "Gerçek zamanlı görünürlük"),
        e("h2", { className: "story-title" }, "Tek ekranda bağlı."),
        e("p", null, "Envanter, iş emirleri ve faturalar ayrı ayrı değil, tek bir sistemin parçaları olarak çalışır. Bir yerde değişen, her yerde anında görünür."),
        e("dl", { className: "story-spec" },
          e("dt", null, "Senkronizasyon"), e("dd", null, "Anlık"),
          e("dt", null, "Erişim"), e("dd", null, "Her cihazdan"),
          e("dt", null, "Yedekleme"), e("dd", null, "Otomatik")))),
    e("section", { className: "story-section" },
      e("div", { className: "story-copy" },
        e("p", { className: "story-tag" }, "Akış"),
        e("h2", { className: "story-title" }, "Veri, doğru yere ulaşır."),
        e("p", null, "Bir parça stoktan düşer, iş emrine işlenir, faturaya yansır. Tek bir kayıt, sistemin her katmanına otomatik olarak taşınır."))),
    e("section", { className: "story-section story-right" },
      e("div", { className: "story-copy" },
        e("p", { className: "story-tag" }, "Platformda"),
        e("h2", { className: "story-title" }, "Her işlem kayıt altında."),
        e("p", null, "Ne satıldığını, ne kullanıldığını ve kimin yaptığını her zaman geriye dönük olarak görebilirsiniz."),
        e("ul", { className: "story-list" },
          [["Stok takibi", "ANLIK"], ["İş emri yönetimi", "UÇTAN UCA"], ["Fatura ve raporlama", "OTOMATİK"], ["Çoklu kullanıcı", "YETKİLİ ERİŞİM"]]
            .map(([name, tag]) => e("li", { key: name }, name, e("span", null, tag)))))),
    e("footer", { className: "story-footer" }, business.fullName));
}
