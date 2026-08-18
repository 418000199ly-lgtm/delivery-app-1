export interface CityItem {
  name: string;
  pinyin: string;
  province?: string;
}

export interface CityGroup {
  letter: string;
  cities: CityItem[];
}

export interface ProvinceData {
  province: string;
  cities: string[];
}

export const PROVINCES_DATA: ProvinceData[] = [
  { province: '直辖市', cities: ['北京', '上海', '天津', '重庆'] },
  { province: '宁夏', cities: ['银川', '石嘴山', '吴忠', '固原', '中卫'] },
  { province: '广东', cities: ['广州', '深圳', '珠海', '汕头', '佛山', '韶关', '湛江', '肇庆', '江门', '茂名', '惠州', '梅州', '汕尾', '河源', '阳江', '清远', '东莞', '中山', '潮州', '揭阳', '云浮'] },
  { province: '浙江', cities: ['杭州', '宁波', '温州', '嘉兴', '湖州', '绍兴', '金华', '衢州', '舟山', '台州', '丽水'] },
  { province: '江苏', cities: ['南京', '无锡', '徐州', '常州', '苏州', '南通', '连云港', '淮安', '盐城', '扬州', '镇江', '泰州', '宿迁'] },
  { province: '山东', cities: ['济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁', '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽'] },
  { province: '河南', cities: ['郑州', '开封', '洛阳', '平顶山', '安阳', '鹤壁', '新乡', '焦作', '濮阳', '许昌', '漯河', '三门峡', '南阳', '商丘', '信阳', '周口', '驻马店', '济源'] },
  { province: '四川', cities: ['成都', '自贡', '攀枝花', '泸州', '德阳', '绵阳', '广元', '遂宁', '内江', '乐山', '南充', '眉山', '宜宾', '广安', '达州', '雅安', '巴中', '资阳', '阿坝', '甘孜', '凉山'] },
  { province: '湖北', cities: ['武汉', '黄石', '十堰', '宜昌', '襄阳', '鄂州', '荆门', '孝感', '荆州', '黄冈', '咸宁', '随州', '恩施', '仙桃', '潜江', '天门', '神农架'] },
  { province: '湖南', cities: ['长沙', '株洲', '湘潭', '衡阳', '邵阳', '岳阳', '常德', '张家界', '益阳', '郴州', '永州', '怀化', '娄底', '湘西'] },
  { province: '福建', cities: ['福州', '厦门', '莆田', '三明', '泉州', '漳州', '南平', '龙岩', '宁德'] },
  { province: '安徽', cities: ['合肥', '芜湖', '蚌埠', '淮南', '马鞍山', '淮北', '铜陵', '安庆', '黄山', '滁州', '阜阳', '宿州', '六安', '亳州', '池州', '宣城'] },
  { province: '江西', cities: ['南昌', '景德镇', '萍乡', '九江', '新余', '鹰潭', '赣州', '吉安', '宜春', '抚州', '上饶'] },
  { province: '河北', cities: ['石家庄', '唐山', '秦皇岛', '邯郸', '邢台', '保定', '张家口', '承德', '沧州', '廊坊', '衡水'] },
  { province: '山西', cities: ['太原', '大同', '阳泉', '长治', '晋城', '朔州', '晋中', '运城', '忻州', '临汾', '吕梁'] },
  { province: '陕西', cities: ['西安', '铜川', '宝鸡', '咸阳', '渭南', '延安', '汉中', '榆林', '安康', '商洛'] },
  { province: '辽宁', cities: ['沈阳', '大连', '鞍山', '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳', '盘锦', '铁岭', '朝阳', '葫芦岛'] },
  { province: '吉林', cities: ['长春', '吉林', '四平', '辽源', '通化', '白山', '松原', '白城', '延边'] },
  { province: '黑龙江', cities: ['哈尔滨', '齐齐哈尔', '鸡西', '鹤岗', '双鸭山', '大庆', '伊春', '佳木斯', '七台河', '牡丹江', '黑河', '绥化', '大兴安岭'] },
  { province: '广西', cities: ['南宁', '柳州', '桂林', '梧州', '北海', '防城港', '钦州', '贵港', '玉林', '百色', '贺州', '河池', '来宾', '崇左'] },
  { province: '云南', cities: ['昆明', '曲靖', '玉溪', '保山', '昭通', '丽江', '普洱', '临沧', '楚雄', '红河', '文山', '西双版纳', '大理', '德宏', '怒江', '迪庆'] },
  { province: '贵州', cities: ['贵阳', '六盘水', '遵义', '安顺', '毕节', '铜仁', '黔西南', '黔东南', '黔南'] },
  { province: '内蒙古', cities: ['呼和浩特', '包头', '乌海', '赤峰', '通辽', '鄂尔多斯', '呼伦贝尔', '巴彦淖尔', '乌兰察布', '兴安盟', '锡林郭勒盟', '阿拉善盟'] },
  { province: '新疆', cities: ['乌鲁木齐', '克拉玛依', '吐鲁番', '哈密', '昌吉', '博尔塔拉', '巴音郭楞', '阿克苏', '克孜勒苏', '喀什', '和田', '伊犁', '塔城', '阿勒泰', '石河子', '阿拉尔', '图木舒克', '五家渠'] },
  { province: '甘肃', cities: ['兰州', '嘉峪关', '金昌', '白银', '天水', '武威', '张掖', '平凉', '酒泉', '庆阳', '定西', '陇南', '临夏', '甘南'] },
  { province: '青海', cities: ['西宁', '海东', '海北', '黄南', '海南', '果洛', '玉树', '海西'] },
  { province: '海南', cities: ['海口', '三亚', '三沙', '儋州'] },
  { province: '西藏', cities: ['拉萨', '日喀则', '昌都', '林芝', '山南', '那曲', '阿里'] }
];

export const ALL_CHINA_CITIES: Array<{ name: string; pinyin: string; province: string }> = PROVINCES_DATA.flatMap(p => 
  p.cities.map(cityName => ({
    name: cityName,
    pinyin: cityName,
    province: p.province
  }))
);

export const CITY_GROUPS: CityGroup[] = [
  {
    letter: 'A',
    cities: [
      { name: '鞍山', pinyin: 'Anshan', province: '辽宁' },
      { name: '安庆', pinyin: 'Anqing', province: '安徽' },
      { name: '安阳', pinyin: 'Anyang', province: '河南' },
      { name: '阿坝', pinyin: 'Aba', province: '四川' }
    ]
  },
  {
    letter: 'B',
    cities: [
      { name: '北京', pinyin: 'Beijing', province: '直辖市' },
      { name: '本溪', pinyin: 'Benxi', province: '辽宁' },
      { name: '包头', pinyin: 'Baotou', province: '内蒙古' },
      { name: '保定', pinyin: 'Baoding', province: '河北' },
      { name: '宝鸡', pinyin: 'Baoji', province: '陕西' },
      { name: '蚌埠', pinyin: 'Bengbu', province: '安徽' }
    ]
  },
  {
    letter: 'C',
    cities: [
      { name: '成都', pinyin: 'Chengdu', province: '四川' },
      { name: '重庆', pinyin: 'Chongqing', province: '直辖市' },
      { name: '长沙', pinyin: 'Changsha', province: '湖南' },
      { name: '长春', pinyin: 'Changchun', province: '吉林' },
      { name: '常州', pinyin: 'Changzhou', province: '江苏' },
      { name: '沧州', pinyin: 'Cangzhou', province: '河北' }
    ]
  },
  {
    letter: 'D',
    cities: [
      { name: '大连', pinyin: 'Dalian', province: '辽宁' },
      { name: '东莞', pinyin: 'Dongguan', province: '广东' },
      { name: '大庆', pinyin: 'Daqing', province: '黑龙江' },
      { name: '大同', pinyin: 'Datong', province: '山西' },
      { name: '德州', pinyin: 'Dezhou', province: '山东' },
      { name: '东营', pinyin: 'Dongying', province: '山东' }
    ]
  },
  {
    letter: 'E',
    cities: [
      { name: '鄂尔多斯', pinyin: 'Ordos', province: '内蒙古' },
      { name: '恩施', pinyin: 'Enshi', province: '湖北' }
    ]
  },
  {
    letter: 'F',
    cities: [
      { name: '福州', pinyin: 'Fuzhou', province: '福建' },
      { name: '佛山', pinyin: 'Foshan', province: '广东' },
      { name: '抚顺', pinyin: 'Fushun', province: '辽宁' },
      { name: '阜新', pinyin: 'Fuxin', province: '辽宁' },
      { name: '阜阳', pinyin: 'Fuyang', province: '安徽' }
    ]
  },
  {
    letter: 'G',
    cities: [
      { name: '广州', pinyin: 'Guangzhou', province: '广东' },
      { name: '贵阳', pinyin: 'Guiyang', province: '贵州' },
      { name: '桂林', pinyin: 'Guilin', province: '广西' },
      { name: '赣州', pinyin: 'Ganzhou', province: '江西' }
    ]
  },
  {
    letter: 'H',
    cities: [
      { name: '杭州', pinyin: 'Hangzhou', province: '浙江' },
      { name: '哈尔滨', pinyin: 'Harbin', province: '黑龙江' },
      { name: '合肥', pinyin: 'Hefei', province: '安徽' },
      { name: '呼和浩特', pinyin: 'Hohhot', province: '内蒙古' },
      { name: '海口', pinyin: 'Haikou', province: '海南' },
      { name: '惠州', pinyin: 'Huizhou', province: '广东' },
      { name: '湖州', pinyin: 'Huzhou', province: '浙江' },
      { name: '邯郸', pinyin: 'Handan', province: '河北' }
    ]
  },
  {
    letter: 'J',
    cities: [
      { name: '济南', pinyin: 'Jinan', province: '山东' },
      { name: '吉林', pinyin: 'Jilin', province: '吉林' },
      { name: '江门', pinyin: 'Jiangmen', province: '广东' },
      { name: '嘉兴', pinyin: 'Jiaxing', province: '浙江' },
      { name: '金华', pinyin: 'Jinhua', province: '浙江' },
      { name: '荆州', pinyin: 'Jingzhou', province: '湖北' },
      { name: '九江', pinyin: 'Jiujiang', province: '江西' }
    ]
  },
  {
    letter: 'K',
    cities: [
      { name: '昆明', pinyin: 'Kunming', province: '云南' },
      { name: '开封', pinyin: 'Kaifeng', province: '河南' },
      { name: '克拉玛依', pinyin: 'Karamay', province: '新疆' }
    ]
  },
  {
    letter: 'L',
    cities: [
      { name: '兰州', pinyin: 'Lanzhou', province: '甘肃' },
      { name: '洛阳', pinyin: 'Luoyang', province: '河南' },
      { name: '临沂', pinyin: 'Linyi', province: '山东' },
      { name: '柳州', pinyin: 'Liuzhou', province: '广西' },
      { name: '连云港', pinyin: 'Lianyungang', province: '江苏' },
      { name: '廊坊', pinyin: 'Langfang', province: '河北' }
    ]
  },
  {
    letter: 'M',
    cities: [
      { name: '马鞍山', pinyin: 'Maanshan', province: '安徽' },
      { name: '茂名', pinyin: 'Maoming', province: '广东' },
      { name: '梅州', pinyin: 'Meizhou', province: '广东' },
      { name: '绵阳', pinyin: 'Mianyang', province: '四川' }
    ]
  },
  {
    letter: 'N',
    cities: [
      { name: '南京', pinyin: 'Nanjing', province: '江苏' },
      { name: '南昌', pinyin: 'Nanchang', province: '江西' },
      { name: '南宁', pinyin: 'Nanning', province: '广西' },
      { name: '宁波', pinyin: 'Ningbo', province: '浙江' },
      { name: '南通', pinyin: 'Nantong', province: '江苏' },
      { name: '南阳', pinyin: 'Nanyang', province: '河南' }
    ]
  },
  {
    letter: 'P',
    cities: [
      { name: '盘锦', pinyin: 'Panjin', province: '辽宁' },
      { name: '平顶山', pinyin: 'Pingdingshan', province: '河南' },
      { name: '莆田', pinyin: 'Putian', province: '福建' }
    ]
  },
  {
    letter: 'Q',
    cities: [
      { name: '青岛', pinyin: 'Qingdao', province: '山东' },
      { name: '秦皇岛', pinyin: 'Qinhuangdao', province: '河北' },
      { name: '泉州', pinyin: 'Quanzhou', province: '福建' },
      { name: '齐齐哈尔', pinyin: 'Qiqihar', province: '黑龙江' },
      { name: '衢州', pinyin: 'Quzhou', province: '浙江' }
    ]
  },
  {
    letter: 'R',
    cities: [
      { name: '日照', pinyin: 'Rizhao', province: '山东' }
    ]
  },
  {
    letter: 'S',
    cities: [
      { name: '上海', pinyin: 'Shanghai', province: '直辖市' },
      { name: '深圳', pinyin: 'Shenzhen', province: '广东' },
      { name: '沈阳', pinyin: 'Shenyang', province: '辽宁' },
      { name: '石家庄', pinyin: 'Shijiazhuang', province: '河北' },
      { name: '苏州', pinyin: 'Suzhou', province: '江苏' },
      { name: '三亚', pinyin: 'Sanya', province: '海南' },
      { name: '绍兴', pinyin: 'Shaoxing', province: '浙江' },
      { name: '汕头', pinyin: 'Shantou', province: '广东' }
    ]
  },
  {
    letter: 'T',
    cities: [
      { name: '天津', pinyin: 'Tianjin', province: '直辖市' },
      { name: '太原', pinyin: 'Taiyuan', province: '山西' },
      { name: '唐山', pinyin: 'Tangshan', province: '河北' },
      { name: '台州', pinyin: 'Taizhou', province: '浙江' },
      { name: '泰州', pinyin: 'Taizhou', province: '江苏' },
      { name: '铁岭', pinyin: 'Tieling', province: '辽宁' }
    ]
  },
  {
    letter: 'W',
    cities: [
      { name: '武汉', pinyin: 'Wuhan', province: '湖北' },
      { name: '无锡', pinyin: 'Wuxi', province: '江苏' },
      { name: '乌鲁木齐', pinyin: 'Urumqi', province: '新疆' },
      { name: '温州', pinyin: 'Wenzhou', province: '浙江' },
      { name: '潍坊', pinyin: 'Weifang', province: '山东' },
      { name: '威海', pinyin: 'Weihai', province: '山东' },
      { name: '芜湖', pinyin: 'Wuhu', province: '安徽' }
    ]
  },
  {
    letter: 'X',
    cities: [
      { name: '西安', pinyin: 'Xian', province: '陕西' },
      { name: '厦门', pinyin: 'Xiamen', province: '福建' },
      { name: '西宁', pinyin: 'Xining', province: '青海' },
      { name: '新乡', pinyin: 'Xinxiang', province: '河南' },
      { name: '咸阳', pinyin: 'Xianyang', province: '陕西' },
      { name: '邢台', pinyin: 'Xingtai', province: '河北' },
      { name: '徐州', pinyin: 'Xuzhou', province: '江苏' },
      { name: '襄阳', pinyin: 'Xiangyang', province: '湖北' }
    ]
  },
  {
    letter: 'Y',
    cities: [
      { name: '银川', pinyin: 'Yinchuan', province: '宁夏' },
      { name: '扬州', pinyin: 'Yangzhou', province: '江苏' },
      { name: '烟台', pinyin: 'Yantai', province: '山东' },
      { name: '宜昌', pinyin: 'Yichang', province: '湖北' },
      { name: '岳阳', pinyin: 'Yueyang', province: '湖南' },
      { name: '盐城', pinyin: 'Yancheng', province: '江苏' },
      { name: '义乌', pinyin: 'Yiwu', province: '浙江' }
    ]
  },
  {
    letter: 'Z',
    cities: [
      { name: '郑州', pinyin: 'Zhengzhou', province: '河南' },
      { name: '珠海', pinyin: 'Zhuhai', province: '广东' },
      { name: '中山', pinyin: 'Zhongshan', province: '广东' },
      { name: '淄博', pinyin: 'Zibo', province: '山东' },
      { name: '漳州', pinyin: 'Zhangzhou', province: '福建' },
      { name: '株洲', pinyin: 'Zhuzhou', province: '湖南' },
      { name: '镇江', pinyin: 'Zhenjiang', province: '江苏' },
      { name: '湛江', pinyin: 'Zhanjiang', province: '广东' }
    ]
  }
];

export const ALL_CITIES_FLAT = ALL_CHINA_CITIES;
