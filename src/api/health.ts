export default function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed',
    });
  }

  return res.status(200).json({
    success: true,
    service: 'DEMIVRA AI Engine',
    status: 'online',
    version: '1.0.0',
  });
}
