// 来自本轮参考图的四类材质场景；全部用于离线提示词与传输检查。
export const materialCases = [
  { id: 'rabbit-blue-dress', description: '白色兔子，脸部和四肢，蓝色棉布裙，布蝴蝶结，装饰针脚，珠眼，毛毡胡萝卜挂饰',
    basePrompt: 'Keep the white rabbit face, tall ears, standing pose and proportions. Preserve its blue woven cotton dress, cloth bow, bead eyes, decorative ear-edge stitches and felt carrot charm. Change only the intended wool body material.',
    profile: { components: ['body', 'face', 'clothing', 'felt-accessories'], mixedMaterials: ['bead-eyes', 'woven-ribbon'], tones: ['light'], scene: 'minimal' } },
  { id: 'green-lizard', description: '绿色蜥蜴，头脸、四肢和尾巴，没有服装，没有翅膀',
    basePrompt: 'Keep the green lizard, open smiling mouth, raised paw, four limbs and curved tail. Keep its pose, colours and complete sculpted form. No clothing or accessories.',
    profile: { components: ['body', 'face'], mixedMaterials: [], tones: [], scene: 'minimal' } },
  { id: 'grey-penguin', description: '灰色企鹅，白色脸部和腹部，羊毛毡外衣与毡领结，珠眼',
    basePrompt: 'Keep the grey penguin, white face and belly, orange beak and feet, felt tuxedo and felt bow tie. Preserve visible irregular interlocked wool strands without repeating yarn loops.',
    profile: { components: ['body', 'face', 'clothing'], mixedMaterials: ['bead-eyes'], tones: ['light', 'dark'], scene: 'minimal' } },
  { id: 'white-beluga', description: '白鲸与幼鲸，头脸，侧鳍，尾部，没有衣服，没有刺绣',
    basePrompt: 'Keep the white beluga mother and calf, face, tiny eyes, flippers, curved bodies and tails. Preserve the dense fine pale felt surface, with visible short wool fibers. No clothing, embroidery or extra animals.',
    profile: { components: ['body', 'face'], mixedMaterials: ['bead-eyes'], tones: ['light'], scene: 'minimal' } },
]
