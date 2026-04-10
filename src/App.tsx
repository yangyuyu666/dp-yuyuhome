import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CalendarDays, Heart, ImageIcon, MessageCircleHeart, Star } from 'lucide-react';

type PhotoGroup = {
  id: string;
  title: string;
  description: string;
  images: { src: string; name: string }[];
};

const imageModules = {
  couple: import.meta.glob('../合照/*.{jpg,jpeg,png,JPG,JPEG,PNG,webp,WEBP}', {
    eager: true,
    import: 'default',
  }),
  tongtong: import.meta.glob('../桶桶/*.{jpg,jpeg,png,JPG,JPEG,PNG,webp,WEBP}', {
    eager: true,
    import: 'default',
  }),
  dandan: import.meta.glob('../蛋蛋/*.{jpg,jpeg,png,JPG,JPEG,PNG,webp,WEBP}', {
    eager: true,
    import: 'default',
  }),
};

function toImages(modules: Record<string, unknown>) {
  return Object.entries(modules)
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([filePath, src]) => ({
      src: String(src),
      name: filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '照片',
    }));
}

const photoGroups: PhotoGroup[] = [
  {
    id: 'couple',
    title: '合照',
    description: '一起走过的地方，一起停下来的瞬间。',
    images: toImages(imageModules.couple),
  },
  {
    id: 'tongtong',
    title: '桶桶',
    description: '关于桶桶的小小相册，留住每一张可爱的表情。',
    images: toImages(imageModules.tongtong),
  },
  {
    id: 'dandan',
    title: '蛋蛋',
    description: '把蛋蛋的日常也认真收藏起来。',
    images: toImages(imageModules.dandan),
  },
];

const heroImage = photoGroups.find((group) => group.images.length > 0)?.images[0]?.src;

export default function App() {
  const [daysTogether, setDaysTogether] = useState(0);

  useEffect(() => {
    const startDate = new Date('2020-02-02T00:00:00');
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    setDaysTogether(diffDays);
  }, []);

  return (
    <div className="min-h-screen font-serif selection:bg-rose-200 selection:text-rose-900">
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 border-b border-rose-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="text-xl font-handwriting text-rose-600 flex items-center gap-2">
            <Heart className="w-5 h-5 fill-rose-500 text-rose-500" />
            D & Y
          </div>
          <div className="hidden md:flex space-x-8 text-sm font-medium text-stone-600">
            <a href="#home" className="hover:text-rose-500 transition-colors">
              首页
            </a>
            <a href="#story" className="hover:text-rose-500 transition-colors">
              我们的故事
            </a>
            <a href="#gallery" className="hover:text-rose-500 transition-colors">
              相册
            </a>
            <a href="#messages" className="hover:text-rose-500 transition-colors">
              留言
            </a>
          </div>
        </div>
      </nav>

      <section
        id="home"
        className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden flex items-center justify-center min-h-[80vh]"
      >
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-rose-50/40 via-white/40 to-[#fffafb] z-10" />
          {heroImage ? (
            <img
              src={heroImage}
              alt="我们的照片"
              className="w-full h-full object-cover opacity-30"
            />
          ) : (
            <div className="w-full h-full bg-[radial-gradient(circle_at_top,#fecdd3,transparent_45%),linear-gradient(180deg,#fff1f2_0%,#fffafb_100%)]" />
          )}
        </div>

        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="text-5xl md:text-7xl font-handwriting text-rose-600 mb-6 tracking-wider">
              戴鹏和杨雯寓的小屋
            </h1>
            <p className="text-lg md:text-xl text-stone-600 mb-12 font-serif max-w-2xl mx-auto leading-relaxed">
              把一起生活的痕迹都留在这里。
              <br />
              合照、桶桶、蛋蛋，慢慢把小屋填满。
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="inline-flex flex-col items-center justify-center p-8 bg-white/60 backdrop-blur-sm rounded-3xl shadow-xl shadow-rose-100/50 border border-rose-50"
          >
            <div className="flex items-center gap-4 text-rose-500 mb-2">
              <CalendarDays className="w-6 h-6" />
              <span className="text-sm font-sans uppercase tracking-widest font-semibold">
                我们相爱的第
              </span>
            </div>
            <div className="text-6xl md:text-7xl font-sans font-bold text-rose-600 my-4">
              {daysTogether} <span className="text-2xl text-rose-400 font-serif font-normal">天</span>
            </div>
            <div className="flex items-center gap-2 text-stone-500 text-sm">
              <Heart className="w-4 h-4 fill-rose-300 text-rose-300" />
              <span>每一天都比昨天更爱你</span>
              <Heart className="w-4 h-4 fill-rose-300 text-rose-300" />
            </div>
          </motion.div>
        </div>

        <motion.div
          animate={{ y: [0, -20, 0] }}
          transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
          className="absolute top-1/4 left-1/4 text-rose-300 opacity-50 hidden md:block"
        >
          <Heart className="w-12 h-12 fill-current" />
        </motion.div>
        <motion.div
          animate={{ y: [0, 20, 0] }}
          transition={{ repeat: Infinity, duration: 5, ease: 'easeInOut', delay: 1 }}
          className="absolute bottom-1/4 right-1/4 text-rose-200 opacity-50 hidden md:block"
        >
          <Star className="w-10 h-10 fill-current" />
        </motion.div>
      </section>

      <section id="story" className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-handwriting text-rose-600 mb-4">我们的故事</h2>
            <div className="w-24 h-1 bg-rose-200 mx-auto rounded-full" />
          </div>

          <div className="space-y-12">
            {[
              {
                year: '初次相遇',
                title: '从那一天开始，生活有了名字',
                desc: '原本平常的日子，因为遇见你，忽然有了想反复记住的细节。',
              },
              {
                year: '一起生活',
                title: '把喜欢藏进很多个日常里',
                desc: '一起去看风景、一起拍照片、一起照顾桶桶和蛋蛋，小屋也一点点变成了现在的样子。',
              },
              {
                year: '以后很长',
                title: '把每个阶段都认真收藏',
                desc: '现在的合照、桶桶和蛋蛋的照片，都会变成以后回头看时最珍贵的纪念。',
              },
            ].map((item, index) => (
              <motion.div
                key={item.year}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.2 }}
                className="flex flex-col md:flex-row gap-6 items-start md:items-center bg-rose-50/30 p-8 rounded-3xl border border-rose-50"
              >
                <div className="md:w-1/3 flex-shrink-0">
                  <div className="text-2xl font-handwriting text-rose-500">{item.year}</div>
                </div>
                <div className="md:w-2/3">
                  <h3 className="text-xl font-bold text-stone-800 mb-3">{item.title}</h3>
                  <p className="text-stone-600 leading-relaxed">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="gallery" className="py-20 bg-rose-50/30">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-handwriting text-rose-600 mb-4">我们的相册</h2>
            <div className="w-24 h-1 bg-rose-200 mx-auto rounded-full" />
            <p className="text-stone-500 mt-6 font-serif"></p>
          </div>

          <div className="space-y-14">
            {photoGroups.map((group, groupIndex) => (
              <motion.section
                key={group.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: groupIndex * 0.1 }}
                className="rounded-[2rem] border border-rose-100 bg-white/80 p-6 md:p-8 shadow-sm"
              >
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-4 py-1.5 text-sm font-medium text-rose-600">
                      <ImageIcon className="h-4 w-4" />
                      {group.title}
                    </div>
                    <h3 className="mt-4 text-2xl md:text-3xl font-handwriting text-stone-800">
                      {group.title}相册
                    </h3>
                    <p className="mt-2 text-stone-500">{group.description}</p>
                  </div>
                  <div className="text-sm text-rose-400">{group.images.length} 张照片</div>
                </div>

                {group.images.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {group.images.map((image, index) => (
                      <motion.figure
                        key={`${group.id}-${image.name}`}
                        initial={{ opacity: 0, scale: 0.96 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.45, delay: index * 0.06 }}
                        className="group overflow-hidden rounded-3xl bg-rose-50 shadow-sm"
                      >
                        <div className="aspect-[4/5] overflow-hidden">
                          <img
                            src={image.src}
                            alt={image.name}
                            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                          />
                        </div>
                        <figcaption className="flex items-center justify-between gap-3 px-5 py-4 text-sm text-stone-600">
                          <span className="truncate">{image.name}</span>
                          <Heart className="h-4 w-4 shrink-0 text-rose-300 fill-rose-200" />
                        </figcaption>
                      </motion.figure>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/60 px-6 py-10 text-center text-stone-500">
                    这个文件夹里暂时还没有可展示的图片。
                  </div>
                )}
              </motion.section>
            ))}
          </div>
        </div>
      </section>

      <section id="messages" className="py-20 bg-white">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <MessageCircleHeart className="w-12 h-12 text-rose-400 mx-auto mb-6" />
          <h2 className="text-3xl md:text-4xl font-handwriting text-rose-600 mb-8">想对你说的话</h2>

          <div className="bg-rose-50/50 p-8 md:p-12 rounded-3xl border border-rose-100 relative">
            <div className="absolute top-4 left-4 text-rose-200">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
              </svg>
            </div>
            <p className="text-lg md:text-xl text-stone-700 leading-loose font-serif relative z-10 italic">
              以后我们还会继续拍很多照片，
              <br />
              把日常、旅行、桶桶和蛋蛋都慢慢存进来，
              <br />
              让这个小屋一直有东西可以回头看。
            </p>
            <div className="mt-8 text-right text-rose-500 font-handwriting text-xl">爱你很久很久</div>
          </div>
        </div>
      </section>

      <footer className="bg-rose-100/50 py-12 text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <span className="font-handwriting text-xl text-rose-600">戴鹏</span>
          <Heart className="w-4 h-4 text-rose-500 fill-rose-500 animate-pulse" />
          <span className="font-handwriting text-xl text-rose-600">杨雯寓</span>
        </div>
        <p className="text-stone-500 text-sm font-sans">
          Made with love &copy; {new Date().getFullYear()} Our Little Cabin
        </p>
      </footer>
    </div>
  );
}
